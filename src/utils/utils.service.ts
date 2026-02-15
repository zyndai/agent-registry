import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CollectMailDto } from './dto/collect-mail.dto';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

@Injectable()
export class UtilsService {
  constructor(private prisma: PrismaService) {}

  async collectMail(createDto: CollectMailDto) {
    try {
      return await this.prisma.mailCollector.create({
        data: createDto,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        // Unique constraint violation (Prisma specific)
        throw new ConflictException('Email already subscribed');
      }
      throw error;
    }
  }

  async joinWaitlist(dto: JoinWaitlistDto) {
    try {
      return await this.prisma.waitlist.create({
        data: dto,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Email already on the waitlist');
      }
      throw error;
    }
  }
}
