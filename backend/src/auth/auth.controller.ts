import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AllowWhilePasswordChangeRequired } from './allow-while-password-change-required.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-request.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @AllowWhilePasswordChangeRequired()
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @AllowWhilePasswordChangeRequired()
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshDto) {
    return this.authService.logout(user.userId, dto.refreshToken);
  }
}
