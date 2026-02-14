// ============================================================================
// HEARTBEAT - FINAL DEFINITIVE VERSION
// FIX #1: status='active' for operational_alerts
// FIX #2: whatsapp_number + is_active column names
// FIX #3: WhatsApp template (new_task_alert)
// FIX #4: Gate #2 compliant - all status changes via safe_update_status RPC
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHash } from "https://deno.land/std@0.168.0/hash/mod.ts"

const TIMEOUT_MINUTES = 2
const MAX_RETRIES = 3
const BATCH_SIZE = 10

const getRetryDelay = (retryCount: number): number => Math.pow(2, retryCount) * 1000

// ============================================================================
// GATE #1: IDEMPOTENCY ENFORCER
// ============================================================================

class IdempotencyEnforcer {
  constructor(private supabase: any) {}

  private generateKey(requestId: number, operation: string, params: any): string {
    const hash = createHash("sha256")
    hash.update(JSON.stringify({ requestId, operation, params, version: 'v1' }))
    return hash.toString()
  }

  async execute<T>(
    requestId: number,
    apiName: string,
    operation: string,
    params: any,
    fn: () => Promise<T>
  ): Promise<T> {
    const idempotencyKey = this.generateKey(requestId, operation, params)

    const { data: inserted } = await this.supabase
      .from('api_idempotency_keys')
      .insert({
        idempotency_key: idempotencyKey,
        request_id: requestId,
        api_name: apiName,
        operation_type: operation,
        request_params: params,
        succeeded: false
      })
      .select()

    if (inserted && inserted.length > 0) {
      console.log(`[${requestId}] ${operation}: Executing`)
      try {
        const result = await fn()
        await this.supabase
          .from('api_idempotency_keys')
          .update({
            succeeded: true,
            response_payload: result,
            external_id: (result as any)?.message_id || (result as any)?.id || null
          })
          .eq('idempotency_key', idempotencyKey)
        return result
      } catch (error) {
        await this.supabase
          .from('api_idempotency_keys')
          .update({ response_payload: { error: error.message } })
          .eq('idempotency_key', idempotencyKey)
        throw error
      }
    } else {
      console.log(`[${requestId}] ${operation}: Key exists, checking result...`)
      const { data: existing } = await this.supabase
        .from('api_idempotency_keys')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .single()

      if (existing?.succeeded) {
        console.log(`[${requestId}] ${operation}: Using cached result`)
        return existing.response_payload as T
      }
      throw new Error('Concurrent operation in progress or previously failed')
    }
  }
}

// ============================================================================
// FIX #3: WHATSAPP TEMPLATE
// Uses approved Meta template - no 24h session limit
// ============================================================================

async function sendWhatsAppTemplate(
  idempotency: IdempotencyEnforcer,
  requestId: number,
  phoneNumber: string,
  templateParams: {
    room: string
    task: string
    urgency: string
  },
  operationType: string
): Promise<any> {
  return await idempotency.execute(
    requestId,
    'whatsapp',
    operationType,
    { phone: phoneNumber, ...templateParams },
    async () => {
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
            to: phoneNumber.replace('+', ''),
            type: 'template',
            template: {
              name: 'new_task_alert',
              language: { code: 'ar' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: templateParams.room },
                    { type: 'text', text: templateParams.task },
                    { type: 'text', text: templateParams.urgency }
                  ]
                }
              ]
            }
          })
        }
      )

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`WhatsApp API error ${response.status}: ${errText}`)
      }

      return await response.json()
    }
  )
}

// ============================================================================
// GEMINI CLASSIFICATION
// ============================================================================

async function callGeminiAPI(
  idempotency: IdempotencyEnforcer,
  requestId: number,
  requestText: string
): Promise<string> {
  return await idempotency.execute(
    requestId,
    'gemini',
    'classify',
    { request_text: requestText },
    async () => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Classify this hotel request into EXACTLY one of these categories: housekeeping, maintenance, room_service, reception. Request: "${requestText}". Reply with ONLY the category name, nothing else.`
              }]
            }]
          })
        }
      )

      if (!response.ok) throw new Error(`Gemini API error: ${response.status}`)

      const data = await response.json()
      const category = data.candidates[0].content.parts[0].text.trim().toLowerCase()
      const validCategories = ['housekeeping', 'maintenance', 'room_service', 'reception']
      return validCategories.includes(category) ? category : 'reception'
    }
  )
}

// ============================================================================
// JOB PROCESSING
// ============================================================================

async function processRequest(
  supabase: any,
  idempotency: IdempotencyEnforcer,
  request: any
) {
  const requestId = request.id

  try {
    await supabase.rpc('log_task_lifecycle', {
      p_request_id: requestId,
      p_event_type: 'PROCESSING',
      p_notes: 'Claimed by heartbeat'
    })

    // AI Classification
    let category = request.category
    if (!category || category === '' || category === null) {
      console.log(`[${requestId}] Classifying with AI...`)
      category = await callGeminiAPI(idempotency, requestId, request.request_text)
      // Category update is NOT a status change - direct update is fine
      await supabase
        .from('guest_requests')
        .update({ category, updated_at: new Date().toISOString() })
        .eq('id', requestId)
      console.log(`[${requestId}] Classified as: ${category}`)
    }

    // FIX #2: Use correct column names
    const { data: staffId, error: staffError } = await supabase
      .rpc('get_next_available_staff', {
        p_hotel_id: request.hotel_id,
        p_category: category
      })

    if (staffError || !staffId) {
      throw new Error(`No available staff for category: ${category}`)
    }

    // FIX #2: Select whatsapp_number, filter by is_active
    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, whatsapp_number, role, is_active')
      .eq('id', staffId)
      .eq('is_active', true)
      .single()

    if (!staff) throw new Error(`Staff ${staffId} not found or inactive`)

    console.log(`[${requestId}] Assigned to: ${staff.name}`)

    // Increment assignment version BEFORE sending WhatsApp
    // Non-status fields - direct update is fine
    const { data: updatedRequest } = await supabase
      .from('guest_requests')
      .update({
        assigned_to: staff.id.toString(),
        assigned_at: new Date().toISOString(),
        assignment_version: (request.assignment_version || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .select('assignment_version')
      .single()

    const currentVersion = updatedRequest?.assignment_version || 1

    // FIX #3: Send template message
    await sendWhatsAppTemplate(
      idempotency,
      requestId,
      staff.whatsapp_number,
      {
        room: request.room_number,
        task: request.request_text,
        urgency: request.urgency || 'normal'
      },
      'send_assignment'
    )

    // GATE #2: Status change MUST go through RPC
    const { data: statusResult } = await supabase.rpc('safe_update_status', {
      p_request_id: requestId,
      p_new_status: 'assigned',
      p_actor: 'system',
      p_notes: `Assigned to ${staff.name} (v${currentVersion})`
    })

    if (statusResult && !statusResult.success) {
      throw new Error(`State transition failed: ${statusResult.error}`)
    }

    console.log(`[${requestId}] ✅ Assigned to ${staff.name} (v${currentVersion})`)
    return { success: true, requestId }

  } catch (error) {
    console.error(`[${requestId}] ❌ Error:`, error.message)

    const newRetryCount = (request.retry_count || 0) + 1

    if (newRetryCount >= MAX_RETRIES) {
      console.log(`[${requestId}] Max retries reached. Moving to dead letter queue.`)

      await supabase.rpc('move_to_failed_jobs', {
        p_request_id: requestId,
        p_failure_reason: `Failed after ${MAX_RETRIES} retries: ${error.message}`
      })

      // FIX #1: status must be 'active'
      await supabase.from('operational_alerts').insert({
        alert_type: 'failed_job',
        severity: 'critical',
        status: 'active',
        hotel_id: request.hotel_id,
        request_id: requestId,
        message: `Job ${requestId} failed after ${MAX_RETRIES} retries: ${error.message}`,
        metadata: { retry_count: newRetryCount }
      })

      return { success: false, requestId, movedToDeadLetter: true }

    } else {
      const nextRetryAt = new Date(Date.now() + getRetryDelay(newRetryCount))

      // GATE #2: Status change via RPC
      await supabase.rpc('safe_update_status', {
        p_request_id: requestId,
        p_new_status: 'pending',
        p_actor: 'system',
        p_notes: `Retry ${newRetryCount}/${MAX_RETRIES}: ${error.message}`
      })

      // Non-status fields - direct update is fine
      await supabase
        .from('guest_requests')
        .update({
          retry_count: newRetryCount,
          next_retry_at: nextRetryAt.toISOString(),
          last_error: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)

      return { success: false, requestId, retry: newRetryCount }
    }
  }
}

// ============================================================================
// TIMEOUT HANDLING
// ============================================================================

async function checkTimeouts(supabase: any, idempotency: IdempotencyEnforcer) {
  const timeoutThreshold = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000)

  const { data: timedOut } = await supabase
    .from('guest_requests')
    .select('*')
    .in('status', ['assigned', 'in_progress'])
    .lt('assigned_at', timeoutThreshold.toISOString())

  if (!timedOut || timedOut.length === 0) return []

  console.log(`⏰ ${timedOut.length} timed-out requests`)

  const results = []

  for (const request of timedOut) {
    try {
      const { data: result } = await supabase.rpc('handle_timeout_and_reassign', {
        p_request_id: request.id,
        p_timed_out_staff_id: parseInt(request.assigned_to)
      })

      if (result?.success && result?.action === 'reassigned') {
        // FIX #2: correct column name
        const { data: updated } = await supabase
          .from('guest_requests')
          .select('assignment_version')
          .eq('id', request.id)
          .single()

        // FIX #3: template message for reassignment
        await sendWhatsAppTemplate(
          idempotency,
          request.id,
          result.new_staff_whatsapp,
          {
            room: request.room_number,
            task: `[REASSIGNED] ${request.request_text}`,
            urgency: 'urgent'
          },
          'send_reassignment'
        )

        console.log(`[${request.id}] ✅ Re-assigned to ${result.new_staff_name} (v${updated?.assignment_version})`)
      }

      // FIX #1: status='active' in timeout surge alert
      if (timedOut.length > 3) {
        await supabase.from('operational_alerts').insert({
          alert_type: 'timeout_surge',
          severity: 'warning',
          status: 'active',
          hotel_id: request.hotel_id,
          message: `${timedOut.length} timeouts in last ${TIMEOUT_MINUTES} minutes`,
          metadata: { count: timedOut.length }
        })
      }

      results.push(result)
    } catch (error) {
      console.error(`[${request.id}] Timeout error:`, error.message)
      results.push({ requestId: request.id, action: 'error', error: error.message })
    }
  }

  return results
}

// ============================================================================
// MAIN HEARTBEAT
// ============================================================================

serve(async (req) => {
  const startTime = Date.now()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const idempotency = new IdempotencyEnforcer(supabase)

    console.log('💓 Heartbeat started')

    const timeoutResults = await checkTimeouts(supabase, idempotency)

    // GATE #6: Per-hotel partitioned job claim
    const { data: pendingRequests, error: claimError } = await supabase
      .rpc('claim_pending_jobs', { p_batch_size: BATCH_SIZE })

    if (claimError) throw new Error(`Claim failed: ${claimError.message}`)

    if (!pendingRequests || pendingRequests.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending requests',
        timeouts: timeoutResults.length,
        duration: Date.now() - startTime
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    console.log(`📬 Claimed ${pendingRequests.length} requests`)

    const results = await Promise.all(
      pendingRequests.map(r => processRequest(supabase, idempotency, r))
    )

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`✅ Done: ${successful} ok, ${failed} failed in ${Date.now() - startTime}ms`)

    return new Response(JSON.stringify({
      success: true,
      processed: pendingRequests.length,
      successful,
      failed,
      timeouts: timeoutResults.length,
      duration: Date.now() - startTime
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('💔 Heartbeat failed:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})