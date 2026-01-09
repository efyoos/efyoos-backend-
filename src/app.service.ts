import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/guest_requests';
  private readonly DB_KEY = 'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5';

  async insertRow(data: any) {
    // 1. Handle Staff Shifts (Ahmed/Karim)
    const hour = new Date().getHours();
    const responsible = (hour >= 8 && hour < 20) ? 'Ahmed' : 'Karim';

    // 2. Prepare the payload to match Supabase exactly
    const payload = {
      hotel_id: data.hotel_id || 'EFYOOS_V1',
      room_number: data.room || '000',      // Fixes Room Number Null
      guest_name: data.guest_name || 'Guest',
      category: data.short_code || 'Service', // Fixes Category Null
      short_code: data.short_code || 'REQ',
      request_text: `Service requested: ${data.short_code}`, // Fixes Request Text Null
      urgency: 'normal',
      assigned_to: responsible,             // Correctly maps staff
      status: 'pending',
      language: 'FR'                        // Standard for V1
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

    return { status: 'Request processed', assigned_to: responsible };
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

