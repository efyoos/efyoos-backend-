import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // This is the direct link to your phone storage
      rootPath: '/sdcard/Documents/hotel-app',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

