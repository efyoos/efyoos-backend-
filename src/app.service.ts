import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';

@Injectable()
export class AppService {
  // These must be defined to fix the "Property does not exist" errors
  private readonly DB_URL = 'https://swuqyrbknkobamnruurl.supabase.co/rest/v1/orders';
  private readonly DB_KEY = 'YOUR_SUPABASE_KEY_HERE';

  async insertRow(data: any) {
    // Fixes "Cannot find name DateTime"
    const algeriaTime = DateTime.now().setZone('Africa/Algiers');
    const hour = algeriaTime.hour;
    const isDay = hour >= 8 && hour < 20;

    const payload = {
      hotel_id: data.hotel_id,
      room: data.room,
      short_code: data.short_code,
      responsible_staff: isDay ? 'Ahmed' : 'Karim',
      shift: isDay ? 'DAY' : 'NIGHT',
      created_at: algeriaTime.toISO(),
    };

    const response = await fetch(this.DB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.DB_KEY,
        'Authorization': `Bearer ${this.DB_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }
}

