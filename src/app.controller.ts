import { Controller, Get, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express'; // Added 'type' here to fix your TS1272 error
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('manager')
  getManager(@Res() res: Response) {
    return res.sendFile('/sdcard/Documents/hotel-app/dashboard.html');
  }

  @Get('guest')
  getGuest(@Res() res: Response) {
    return res.sendFile('/sdcard/Documents/hotel-app/index.html');
  }

  @Post('request')
  async handleRequest(@Body() payload: any) {
    const result = await this.appService.createRequest(payload);
    return { success: true, data: result };
  }
}

