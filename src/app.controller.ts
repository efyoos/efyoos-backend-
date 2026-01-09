import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return 'Efyoos Backend is Live!';
  }

  // Guest clicks button -> This runs
  @Post('request')
  async handleRequest(@Body() payload: any) {
    return await this.appService.insertRow(payload);
  }

  // Dashboard loads -> This runs
  @Get('orders')
  async showOrders() {
    return await this.appService.getOrders();
  }
}

