import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/services/prisma.service'
import type { RuleType } from 'src/generated/prisma/enums'

@Injectable()
export class JdRepo {
  constructor(private readonly prisma: PrismaService) {}

  async createJd(userId: string, title?: string) {
    return this.prisma.jobDescription.create({
      data: {
        userId,
        title,
      },
    })
  }

  async findJdById(jdId: string) {
    return this.prisma.jobDescription.findUnique({
      where: { id: jdId },
    })
  }

  async findJdByIdWithRulesAndChunks(jdId: string) {
    return this.prisma.jobDescription.findUnique({
      where: { id: jdId },
      include: {
        rules: {
          include: {
            chunks: true,
          },
        },
      },
    })
  }

  async findJdsByUserId(userId: string) {
    return this.prisma.jobDescription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        rules: {
          include: {
            _count: {
              select: { chunks: true },
            },
          },
        },
      },
    })
  }

  async createJdRule(jdId: string, ruleType: RuleType, content: string) {
    return this.prisma.jDRule.create({
      data: {
        jdId,
        ruleType,
        content,
      },
    })
  }

  async createJdRules(rules: Array<{ jdId: string; ruleType: RuleType; content: string }>) {
    return this.prisma.jDRule.createMany({
      data: rules,
    })
  }

  async createJdRuleChunk(ruleId: string, content: string) {
    return this.prisma.jDRuleChunk.create({
      data: {
        ruleId,
        content,
      },
    })
  }

  async createJdRuleChunks(chunks: Array<{ ruleId: string; content: string }>) {
    return this.prisma.jDRuleChunk.createMany({
      data: chunks,
    })
  }

  async findRulesByJdId(jdId: string) {
    return this.prisma.jDRule.findMany({
      where: { jdId },
      include: {
        chunks: true,
      },
    })
  }

  async findChunksWithoutEmbedding(jdId: string) {
    return this.prisma.jDRuleChunk.findMany({
      where: {
        rule: { jdId },
        embedding: null,
      },
    })
  }

  async deleteJd(jdId: string) {
    return this.prisma.jobDescription.delete({
      where: { id: jdId },
    })
  }
}
