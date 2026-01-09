import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/guest_requests';
  private readonly DB_KEY = 'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5';

    async insertRow(data: any) {
    // 1. Determine staff shift based on local time
    const hour = new Date().getHours();
    const responsible = (hour >= 8 && hour < 20) ? 'Ahmed' : 'Karim';

    // 2. This is the updated payload matching your Supabase columns exactly
    const payload = {
      hotel_id: data.hotel_id || 'EFYOOS_V1',
      room_number: data.room_number || data.room || '000',
      guest_name: data.guest_name || 'Guest',
      // Cleans "recep/maint" into "MAINT"
      category: (data.short_code || 'Service').split('/').pop().toUpperCase(),
      request_text: data.request_text || `Service requested: ${data.short_code}`,
      urgency: 'normal',
      assigned_to: responsible,
      status: 'pending',
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

