import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    // 다음 단계에서 추가:
    // AuthModule, StoresModule, TournamentsModule, LiveModule,
    // UsersModule, SeriesModule, NotificationsModule, AnalyticsModule
  ],
  controllers: [HealthController],
})
export class AppModule {}
