import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // This makes your main URL work
  @Get()
  getHello(): string {
    return 'Efyoos Backend is Live!';
  }

  // This is the link your frontend will talk to
  @Post('request')
  async handleRequest(@Body() payload: any) {
    // This calls the insertRow function we fixed in your service
    return await this.appService.insertRow(payload);
  }
}

