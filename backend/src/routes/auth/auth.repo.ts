import { Injectable } from "@nestjs/common";
import { SerializeAll } from 'src/shared/constants/serialize.decorator'
import { PrismaService } from "src/shared/services/prisma.service";
import { UserType } from "src/shared/model/share-user.model";
import type { EmailVerificationModel, UserModel } from "src/generated/prisma/models";
import type { VerificationCodeType } from "src/generated/prisma/enums";

@Injectable()
@SerializeAll()
export class AuthRepo {
    constructor(private readonly prisma: PrismaService) { }

    // User methods
    async createUser(
        user: Pick<UserType, 'email' | 'password'>
    ): Promise<Omit<UserModel, 'password'>> {
        return this.prisma.user.create({
            data: {
                email: user.email,
                password: user.password,
            },
            omit: { password: true }
        }) as Promise<Omit<UserModel, 'password'>>;
    }

    async findUserByEmail(email: string): Promise<UserModel | null> {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }

    async findUserById(id: string): Promise<UserModel | null> {
        return this.prisma.user.findUnique({
            where: { id },
            omit: { password: true }
        }) as Promise<UserModel | null>;
    }

    async updateUserPassword(userId: string, passwordHash: string): Promise<Omit<UserModel, 'password'>> {
        return this.prisma.user.update({
            where: { id: userId },
            data: { password: passwordHash },
            omit: { password: true }
        }) as Promise<Omit<UserModel, 'password'>>;
    }

    async updateUserEmailVerified(userId: string, verified: boolean): Promise<Omit<UserModel, 'password'>> {
        return this.prisma.user.update({
            where: { id: userId },
            data: { emailVerified: verified },
            omit: { password: true }
        }) as Promise<Omit<UserModel, 'password'>>;
    }

    // Email Verification methods
    async createVerificationCode(payload: {
        userId: string;
        codeHash: string;
        type: VerificationCodeType;
        expiresAt: Date;
    }): Promise<EmailVerificationModel> {
        return this.prisma.emailVerification.create({
            data: {
                userId: payload.userId,
                codeHash: payload.codeHash,
                type: payload.type,
                expiresAt: payload.expiresAt,
            },
        });
    }

    async findVerificationCode(
        userId: string,
        codeHash: string,
        type: VerificationCodeType
    ): Promise<EmailVerificationModel | null> {
        return this.prisma.emailVerification.findFirst({
            where: {
                userId,
                codeHash,
                type,
                used: false,
                expiresAt: {
                    gt: new Date(),
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async findActiveVerificationCode(
        userId: string,
        type: VerificationCodeType
    ): Promise<EmailVerificationModel | null> {
        return this.prisma.emailVerification.findFirst({
            where: {
                userId,
                type,
                used: false,
                expiresAt: {
                    gt: new Date(),
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async markVerificationCodeAsUsed(id: string): Promise<EmailVerificationModel> {
        return this.prisma.emailVerification.update({
            where: { id },
            data: { used: true },
        });
    }

    async invalidateOldVerificationCodes(
        userId: string,
        type: VerificationCodeType
    ): Promise<{ count: number }> {
        return this.prisma.emailVerification.updateMany({
            where: {
                userId,
                type,
                used: false,
            },
            data: {
                used: true,
            },
        });
    }

    // Refresh Token methods
    async createRefreshToken(payload: {
        userId: string;
        token: string;
        expiresAt: Date;
    }): Promise<void> {
        await this.prisma.refreshToken.create({
            data: {
                userId: payload.userId,
                token: payload.token,
                expiresAt: payload.expiresAt,
            },
        });
    }

    async findRefreshToken(token: string): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
        return await this.prisma.refreshToken.findFirst({
            where: {
                token,
                expiresAt: {
                    gt: new Date(),
                },
            },
            select: {
                id: true,
                userId: true,
                expiresAt: true,
            },
        });
    }

    async deleteRefreshToken(id: string): Promise<void> {
        await this.prisma.refreshToken.delete({
            where: { id },
        });
    }

    async deleteRefreshTokensByUserId(userId: string): Promise<{ count: number }> {
        return await this.prisma.refreshToken.deleteMany({
            where: { userId },
        });
    }

    async deleteExpiredRefreshTokens(): Promise<{ count: number }> {
        return await this.prisma.refreshToken.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
            },
        });
    }
}