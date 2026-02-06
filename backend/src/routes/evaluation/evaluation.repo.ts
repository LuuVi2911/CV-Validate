import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/services/prisma.service'
import type { EvaluationResultDTO } from './evaluation.dto'

@Injectable()
export class EvaluationRepo {
  constructor(private readonly prisma: PrismaService) {}

  async createEvaluation(
    userId: string,
    cvId: string,
    jdId: string | undefined,
    results: EvaluationResultDTO,
    id?: string,
  ) {
    return await this.prisma.evaluation.create({
      data: {
        id,
        userId,
        cvId,
        jdId,
        results: results as any,
      },
    })
  }

  async findEvaluationsByUserId(userId: string) {
    return await this.prisma.evaluation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        cv: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        },
        jd: {
          select: {
            id: true,
            title: true,
            createdAt: true,
          },
        },
      },
    })
  }

  async findEvaluationById(id: string) {
    return await this.prisma.evaluation.findUnique({
      where: { id },
      include: {
        cv: true,
        jd: true,
      },
    })
  }

  async findById(id: string) {
    return await this.prisma.evaluation.findUnique({
      where: { id },
    })
  }

  async deleteById(id: string) {
    return await this.prisma.evaluation.delete({
      where: { id },
    })
  }
}
