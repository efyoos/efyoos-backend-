import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/guest_requests';
  private readonly DB_KEY = 'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5';

  // 1. Function to Insert a New Order
  async insertRow(data: any) {
    const { hotel_id, room, short_code } = data;

    // Shift Logic: Ahmed (8h to 20h), Karim (20h to 8h)
    const hour = new Date().getHours();
    const responsible = (hour >= 8 && hour < 20) ? 'Ahmed' : 'Karim';

    const response = await fetch(this.DB_URL, {
      method: 'POST',
      headers: {
        'apikey': this.DB_KEY,
        'Authorization': `Bearer ${this.DB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        hotel_id: hotel_id || 'ALGERIA_TRIAL',
        room: room,
        short_code: short_code,
        responsible_staff: responsible
      }),
    });

    return response.json();
  }

  // 2. Function to Get Orders for the Dashboard
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

