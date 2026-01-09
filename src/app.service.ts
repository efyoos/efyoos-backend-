import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/guest_requests';
  private readonly DB_KEY = 'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5';

  async insertRow(data: any) {
    const hour = new Date().getHours();
    const responsible = (hour >= 8 && hour < 20) ? 'Ahmed' : 'Karim';

    const response = await fetch(this.DB_URL, {
      method: 'POST',
      headers: {
        'apikey': this.DB_KEY,
        'Authorization': `Bearer ${this.DB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        hotel_id: data.hotel_id || 'ALGERIA_TRIAL_01',
        room_number: data.room, // Matched to your supabase column
        guest_name: data.guest_name || 'Guest', // Matched
        short_code: data.short_code,
        assigned_to: responsible, // Matched to your supabase column
        status: 'pending'
      }),
    });

    return { status: 'Request processed' };
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

