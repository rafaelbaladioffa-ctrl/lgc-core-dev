import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
})
export class AuthModule {}
