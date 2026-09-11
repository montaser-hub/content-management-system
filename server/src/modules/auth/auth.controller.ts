import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  baseCookieOptions,
  getCookie,
  REFRESH_TOKEN_COOKIE,
} from '../../common/constants/auth.constants';
import type { AppConfig } from '../../config/configuration';
import { AuthService, type IssuedTokens } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Public self-registration. Creates a PENDING_APPROVAL account — does not log the caller in.',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log in with email + password, receive JWT cookies.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.login(dto);
    this.setAuthCookies(res, tokens);
    return { user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new access token.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refresh(
      getCookie(req, REFRESH_TOKEN_COOKIE),
    );
    this.setAuthCookies(res, tokens);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke the current session and clear auth cookies.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(getCookie(req, REFRESH_TOKEN_COOKIE));
    this.clearAuthCookies(res);
    return { ok: true };
  }

  private get cookieOptions() {
    const isProduction =
      this.config.getOrThrow('nodeEnv', { infer: true }) === 'production';
    return baseCookieOptions(isProduction);
  }

  private setAuthCookies(res: Response, tokens: IssuedTokens) {
    const options = this.cookieOptions;

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...options,
      path: '/',
      maxAge: tokens.accessTokenTtlSeconds * 1000,
    });

    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...options,
      path: '/auth',
      maxAge: tokens.refreshTokenTtlSeconds * 1000,
    });
  }

  private clearAuthCookies(res: Response) {
    const options = this.cookieOptions;

    res.clearCookie(ACCESS_TOKEN_COOKIE, { ...options, path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...options, path: '/auth' });
  }
}
