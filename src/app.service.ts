import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/guest_requests';
  private readonly DB_KEY = 'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5';

  async insertRow(data: any) {
    const hour = new Date().getHours();
    const responsible = (hour >= 8 && hour < 20) ? 'Ahmed' : 'Karim';

    const payload = {
      hotel_id: data.hotel_id || 'EFYOOS_V1',
      // Takes room_number from request, falls back to 000 if missing
      room_number: data.room_number || data.room || '000', 
      guest_name: data.guest_name || 'Guest',
      category: data.short_code, // Store "MAINT" or "HK" here
      // n8n will replace this, but we send a placeholder for now
      short_code: data.short_code || 'PENDING', 
      request_text: data.request_text || `Service: ${data.short_code}`,
      urgency: data.urgency || 'normal',
      assigned_to: responsible,
      status: 'pending',
      // Captures the language used on the guest device
      language: data.language || 'fr' 
    };

    const response = await fetch(this.DB_URL, {
      method: 'POST',
      headers: {
        'apikey': this.DB_KEY,
        'Authorization': `Bearer ${this.DB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload),
    });

    return { status: 'success', assigned: responsible };
  }

  async getOrders() {
    const response = await fetch(`${this.DB_URL}?select=*&order=created_at.desc`, {
      headers: {
        'apikey': this.DB_KEY,
        'Authorization': `Bearer ${this.DB_KEY}`
      }
    });
    return response.json();
  }
}

