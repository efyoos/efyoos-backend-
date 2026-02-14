// ============================================================================
// WHATSAPP WEBHOOK - FINAL DEFINITIVE VERSION
// GATE #3: Late response handling with assignment_version + lock
// FIX: Uses task_followup template for DONE/REPORT (no 24h limit)
// Two-phase completion: ACCEPT → DONE/REPORT
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const url = new URL(req.url)

  // ============================================================
  // WEBHOOK VERIFICATION (GET)
  // ============================================================

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) {
      console.log('✅ WhatsApp webhook verified')
      return new Response(challenge, { status: 200 })
    }

    return new Response('Forbidden', { status: 403 })
  }

  // ============================================================
  // HANDLE WHATSAPP MESSAGE (POST)
  // ============================================================

  if (req.method === 'POST') {
    try {
      const body = await req.json()

      const entry = body.entry?.[0]
      const changes = entry?.changes?.[0]
      const message = changes?.value?.messages?.[0]

      if (!message) {
        return new Response('No message', { status: 200 })
      }

      if (message.type !== 'interactive' || !message.interactive?.button_reply) {
        return new Response('Not a button reply', { status: 200 })
      }

      const buttonId = message.interactive.button_reply.id
      const from = message.from

      console.log(`📱 Button pressed: ${buttonId} from ${from}`)

      // GATE #3: Parse button with version
      // Format: accept_123_v5, decline_123_v5, done_123_v5, report_123_v5
      const parts = buttonId.split('_')
      if (parts.length < 3) {
        console.warn(`Invalid button format: ${buttonId}`)
        return new Response('Invalid button', { status: 200 })
      }

      const action = parts[0]
      const requestIdStr = parts[1]
      const versionStr = parts[2]

      const requestId = parseInt(requestIdStr)
      const buttonVersion = parseInt(versionStr.substring(1)) // Remove 'v' prefix

      if (!['accept', 'decline', 'done', 'report'].includes(action) || !requestId || isNaN(buttonVersion)) {
        console.warn(`Invalid button data: action=${action}, id=${requestId}, version=${buttonVersion}`)
        return new Response('Invalid button', { status: 200 })
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      // GATE #3: handle_staff_response validates version + status atomically
      const { data: result, error: responseError } = await supabase.rpc('handle_staff_response', {
        p_request_id: requestId,
        p_staff_whatsapp: `+${from}`,
        p_action: action,
        p_button_version: buttonVersion
      })

      if (responseError) {
        console.error('Error handling staff response:', responseError)
        return new Response('Error', { status: 500 })
      }

      // ============================================================
      // GATE #3: Handle rejection reasons
      // ============================================================

      if (!result.success) {
        if (result.reason === 'stale_assignment') {
          await sendTextMessage(from,
            `⚠️ This task was reassigned after timeout.\nYou can ignore this message.`
          )
          console.log(`⏰ Stale response rejected: request ${requestId}, from ${from}`)
          return new Response('Stale response', { status: 200 })
        }

        if (result.reason === 'invalid_status') {
          const { data: req } = await supabase
            .from('guest_requests').select('status').eq('id', requestId).single()
          await sendTextMessage(from,
            `⚠️ Cannot perform this action.\nTask is already: ${req?.status || 'completed'}`
          )
          console.log(`❌ Late ${action} rejected for request ${requestId}`)
          return new Response('Invalid status', { status: 200 })
        }

        if (result.reason === 'concurrent_modification') {
          await sendTextMessage(from, `⚠️ Task is being updated. Please try again.`)
          return new Response('Concurrent modification', { status: 200 })
        }

        if (result.reason === 'not_assigned') {
          await sendTextMessage(from, `⚠️ You are not assigned to this task.`)
          return new Response('Not assigned', { status: 200 })
        }
      }

      // ============================================================
      // Get updated request for confirmation messages
      // ============================================================

      const { data: request } = await supabase
        .from('guest_requests')
        .select('*, assigned_staff:staff!assigned_to(id, name, whatsapp_number), assignment_version')
        .eq('id', requestId)
        .single()

      // ============================================================
      // Send confirmation based on action
      // ============================================================

      if (action === 'accept' && result.success) {
        // Send follow-up with DONE/REPORT using task_followup template
        await sendFollowUpTemplate(from, request, requestId, request.assignment_version)
        console.log(`✅ Request ${requestId} accepted. Follow-up sent.`)

      } else if (action === 'done' && result.success) {
        await sendTextMessage(from,
          `✅ Task completed!\n\nThank you ${request?.assigned_staff?.name}.\nRoom ${request?.room_number} - done.`
        )
        console.log(`✅ Request ${requestId} completed by ${from}`)

      } else if (action === 'report' && result.success) {
        await sendTextMessage(from,
          `⚠️ Issue reported for Room ${request?.room_number}.\nYour manager has been notified.`
        )

        // Trigger admin alert (Gate #4)
        await supabase.rpc('create_alert', {
          p_alert_type: 'staff_reported_issue',
          p_severity: 'warning',
          p_message: `Staff ${request?.assigned_staff?.name} reported issue: ${request?.request_text}`,
          p_hotel_id: request?.hotel_id,
          p_request_id: requestId
        })

        console.log(`⚠️ Issue reported for request ${requestId}`)

      } else if (action === 'decline' && result.success) {
        await sendTextMessage(from,
          `Understood. We will find another staff member. Thank you for responding.`
        )
        console.log(`❌ Request ${requestId} declined by ${from}`)
      }

      return new Response('OK', { status: 200 })

    } catch (error) {
      console.error('Webhook error:', error)
      return new Response('Error', { status: 500 })
    }
  }

  return new Response('Method not allowed', { status: 405 })
})

// ============================================================================
// HELPER: SEND FOLLOW-UP USING task_followup TEMPLATE
// GATE #3: Version included in button payloads
// Uses approved template - no 24h session limit
// ============================================================================

async function sendFollowUpTemplate(
  to: string,
  request: any,
  requestId: number,
  version: number
) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: 'task_followup',
            language: { code: 'ar' },
            components: [
              {
                type: 'header',
                parameters: [
                  { type: 'text', text: request?.room_number || '' }
                ]
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: request?.request_text || '' }
                ]
              },
              {
                // GATE #3: DONE button with version
                type: 'button',
                sub_type: 'quick_reply',
                index: '0',
                parameters: [
                  { type: 'payload', payload: `done_${requestId}_v${version}` }
                ]
              },
              {
                // GATE #3: REPORT button with version
                type: 'button',
                sub_type: 'quick_reply',
                index: '1',
                parameters: [
                  { type: 'payload', payload: `report_${requestId}_v${version}` }
                ]
              }
            ]
          }
        })
      }
    )

    if (!response.ok) {
      const err = await response.text()
      console.error(`❌ Follow-up template failed: ${err}`)
      // Fallback to interactive message if template fails
      await sendFollowUpInteractive(to, request, requestId, version)
    } else {
      console.log(`📬 Follow-up template sent (v${version}) to ${to}`)
    }

  } catch (error) {
    console.error('Failed to send follow-up template:', error)
    // Fallback to interactive message
    await sendFollowUpInteractive(to, request, requestId, version)
  }
}

// ============================================================================
// FALLBACK: INTERACTIVE FOLLOW-UP (works within 24h window)
// Used if task_followup template fails for any reason
// ============================================================================

async function sendFollowUpInteractive(
  to: string,
  request: any,
  requestId: number,
  version: number
) {
  try {
    await fetch(
      `https://graph.facebook.com/v17.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: `📋 Room ${request?.room_number}\nTask: ${request?.request_text}\n\nPlease update status:`
            },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: {
                    id: `done_${requestId}_v${version}`,
                    title: '✓ Done'
                  }
                },
                {
                  type: 'reply',
                  reply: {
                    id: `report_${requestId}_v${version}`,
                    title: '⚠️ Issue'
                  }
                }
              ]
            }
          }
        })
      }
    )
    console.log(`📬 Follow-up interactive sent (fallback, v${version}) to ${to}`)
  } catch (error) {
    console.error('Failed to send follow-up interactive:', error)
  }
}

// ============================================================================
// HELPER: SEND SIMPLE TEXT MESSAGE
// ============================================================================

async function sendTextMessage(to: string, text: string) {
  try {
    await fetch(
      `https://graph.facebook.com/v17.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text }
        })
      }
    )
  } catch (error) {
    console.error('Failed to send text message:', error)
  }
}