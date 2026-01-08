import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class AppService {
  private supabase = createClient(
    'https://swuqyrbknkobamnruurl.supabase.co',
    'sb_publishable_TWLdfpE7RjUku1XgPLNSvQ_dpCh8kN5'
  );

 async insertRow(data: any) {
    // 1. Calculate Shift Logic for Algeria
    const algeriaTime = DateTime.now().setZone('Africa/Algiers');
    const hour = algeriaTime.hour;
    const isDay = hour >= 8 && hour < 20;
    
    // 2. Prepare the data with your specific requirements
    const payload = {
      hotel_id: data.hotel_id, 
      room: data.room,
      short_code: data.short_code,
      responsible_staff: isDay ? 'Ahmed' : 'Karim', // Linking service to staff
      shift: isDay ? 'DAY' : 'NIGHT',               // Handling day/night shifts
      created_at: algeriaTime.toISO(),
    };

    // 3. Send the data to your external service (the "Insert Row" node)
    try {
      const response = await fetch(this.DB_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.DB_KEY, // Use the header name your DB requires
          'Authorization': `Bearer ${this.DB_KEY}`
        },
        body: JSON.stringify(payload),
      });

      return await response.json();
    } catch (error) {
      console.error('Error inserting row:', error);
      throw error;
    }
  }
}

