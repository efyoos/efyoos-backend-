// ============================================================================
// SEND ADMIN ALERT - PATCHED VERSION
// FIX #1: status='active' for operational_alerts
// FIX #2: whatsapp_number column name
// FIX #3: WhatsApp template instead of text
// FIX #4: Graceful degradation if SendGrid/Twilio secrets missing
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const body = await req.json()

    const {
      alert_id,
      severity,
      message,
      hotel_id,
      admin_whatsapp,
      admin_email,
      is_escalation = false
    } = body

    console.log(`🚨 Alert #${alert_id} [${severity}] escalation=${is_escalation}`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get admin if not passed directly
    let targetWhatsApp = admin_whatsapp
    let targetEmail = admin_email

    if (!targetWhatsApp && hotel_id) {
      // FIX #2: select whatsapp_number (correct column name)
      const { data: admin } = await supabase
        .from('hotel_admins')
        .select('name, whatsapp_number, email')  // FIX #2
        .eq('hotel_id', hotel_id)
        .eq('is_primary', true)
        .single()

      if (admin) {
        targetWhatsApp = admin.whatsapp_number  // FIX #2
        targetEmail = admin.email
      }
    }

    if (!targetWhatsApp) {
      console.error(`No admin WhatsApp found for hotel ${hotel_id}`)
      return new Response(JSON.stringify({
        success: false,
        error: `No admin found for hotel ${hotel_id}. Add one to hotel_admins table.`
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const results: any = { whatsapp: null, email: null, sms: null }

    // ============================================================
    // FIX #3: WHATSAPP TEMPLATE (bypasses 24h session window)
    // Template name: admin_alert (register in Meta Dashboard)
    // ============================================================

    try {
      const prefix = is_escalation ? '🚨 ESCALATED' : '⚠️ ALERT'
      const shortMessage = message.substring(0, 200)

      const whatsappBody = {
        messaging_product: 'whatsapp',
        to: targetWhatsApp.replace('+', ''),  // Meta requires no + prefix
        type: 'template',
        template: {
          name: 'admin_alert',          // Register this in Meta Dashboard
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: prefix },
                { type: 'text', text: String(alert_id) },
                { type: 'text', text: severity.toUpperCase() },
                { type: 'text', text: shortMessage }
              ]
            }
          ]
        }
      }

      const whatsappResponse = await fetch(
        `https://graph.facebook.com/v17.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(whatsappBody)
        }
      )

      const whatsappData = await whatsappResponse.json()

      if (whatsappResponse.ok) {
        results.whatsapp = { success: true, message_id: whatsappData.messages?.[0]?.id }
        console.log(`✅ WhatsApp template sent to ${targetWhatsApp}`)
      } else {
        results.whatsapp = { success: false, error: whatsappData }
        console.error(`❌ WhatsApp failed:`, whatsappData)
      }
    } catch (err) {
      results.whatsapp = { success: false, error: err.message }
      console.error(`❌ WhatsApp exception:`, err.message)
    }

    // ============================================================
    // EMAIL VIA SENDGRID
    // FIX #4: Only attempt if secret exists (graceful degradation)
    // ============================================================

    const sendgridKey = Deno.env.get('SENDGRID_API_KEY')

    if (targetEmail && sendgridKey) {
      try {
        const emailResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sendgridKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: targetEmail }] }],
            from: {
              email: Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@efyoos.com',
              name: 'Efyoos Alerts'
            },
            subject: `${is_escalation ? '🚨 ESCALATED: ' : '⚠️ '}Alert #${alert_id} [${severity.toUpperCase()}]`,
            content: [{
              type: 'text/plain',
              value: `${is_escalation ? 'ESCALATED ALERT\n' : ''}Alert #${alert_id}\nSeverity: ${severity}\n\n${message}\n\nLogin to your dashboard to acknowledge or resolve this alert.`
            }]
          })
        })

        results.email = emailResponse.ok || emailResponse.status === 202
          ? { success: true }
          : { success: false, status: emailResponse.status }

        console.log(`${results.email.success ? '✅' : '❌'} Email to ${targetEmail}`)
      } catch (err) {
        results.email = { success: false, error: err.message }
      }
    } else {
      // FIX #4: Don't crash, just skip
      results.email = { success: false, reason: 'SENDGRID_API_KEY not configured' }
      console.log(`⚠️ Email skipped - SENDGRID_API_KEY not set`)
    }

    // ============================================================
    // SMS VIA TWILIO (escalation only)
    // FIX #4: Only attempt if secrets exist
    // ============================================================

    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER')

    if (is_escalation && twilioSid && twilioToken && twilioPhone) {
      try {
        const smsResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              From: twilioPhone,
              To: targetWhatsApp,
              Body: `🚨 URGENT Alert #${alert_id} unacknowledged 4+ hours: ${message.substring(0, 100)}`
            })
          }
        )

        const smsData = await smsResponse.json()
        results.sms = smsResponse.ok
          ? { success: true, sid: smsData.sid }
          : { success: false, error: smsData }

        console.log(`${results.sms.success ? '✅' : '❌'} SMS to ${targetWhatsApp}`)
      } catch (err) {
        results.sms = { success: false, error: err.message }
      }
    } else if (is_escalation) {
      // FIX #4: Don't crash, just skip
      results.sms = { success: false, reason: 'Twilio secrets not configured' }
      console.log(`⚠️ SMS skipped - Twilio secrets not set`)
    }

    // Log to api_call_logs
    await supabase.from('api_call_logs').insert({
      api_name: 'admin_notification',
      endpoint: 'send_alert',
      method: 'POST',
      request_payload: { alert_id, severity, is_escalation },
      response_payload: results,
      succeeded: results.whatsapp?.success === true
    })

    return new Response(JSON.stringify({
      success: true,
      alert_id,
      results
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('Alert function crashed:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})