// ============================================================================
// GUEST REQUEST API - FINAL PRODUCTION VERSION
// Entry point for new guest requests
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface GuestRequest {
  hotel_id: string
  room_number: string
  request_text: string
  guest_name?: string
  urgency?: string
  language?: string
  category?: string
  short_code?: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  }
  
  try {
    const body: GuestRequest = await req.json()
    
    // Validate required fields
    if (!body.hotel_id || !body.room_number || !body.request_text) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: hotel_id, room_number, request_text'
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    // Generate short code if not provided
    const shortCode = body.short_code || generateShortCode()
    
    // Determine priority based on urgency
    const priorityMap: { [key: string]: number } = {
      'urgent': 10,
      'high': 8,
      'normal': 5,
      'low': 3
    }
    const priority = priorityMap[body.urgency || 'normal'] || 5
    
    // Insert into guest_requests table
    const { data: request, error: insertError } = await supabase
      .from('guest_requests')
      .insert({
        hotel_id: body.hotel_id,
        room_number: body.room_number,
        request_text: body.request_text,
        guest_name: body.guest_name || null,
        urgency: body.urgency || 'normal',
        language: body.language || 'en',
        category: body.category || null,
        short_code: shortCode,
        status: 'pending',
        priority: priority,
        retry_count: 0,
        max_retries: 3,
        assignment_version: 0
      })
      .select()
      .single()
    
    if (insertError) {
      // Check for duplicate short_code (idempotency at request level)
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('guest_requests')
          .select('*')
          .eq('short_code', shortCode)
          .single()
        
        if (existing) {
          console.log(`⚠️ Duplicate request detected (short_code: ${shortCode})`)
          return new Response(
            JSON.stringify({
              success: true,
              request_id: existing.id,
              short_code: shortCode,
              message: 'Request already exists',
              is_duplicate: true
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              }
            }
          )
        }
      }
      
      throw new Error(`Failed to create request: ${insertError.message}`)
    }
    
    // Log lifecycle event
    await supabase.rpc('log_task_lifecycle', {
      p_request_id: request.id,
      p_event_type: 'CREATED',
      p_notes: 'Guest request received via API'
    })
    
    console.log(`✅ Request created: ${request.id} (${shortCode})`)
    
    // Return 200 OK immediately (async processing)
    return new Response(
      JSON.stringify({
        success: true,
        request_id: request.id,
        short_code: shortCode,
        message: 'Request received and queued for processing',
        estimated_processing_time: '60 seconds',
        status: 'pending'
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
    
  } catch (error) {
    console.error('Error creating request:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})

// ============================================================================
// HELPER: Generate Short Code
// ============================================================================

function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}