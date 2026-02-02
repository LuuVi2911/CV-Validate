import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/services/prisma.service'
import type { CvStatus, CvSectionType } from 'src/generated/prisma/enums'

@Injectable()
export class CvRepo {
  constructor(private readonly prisma: PrismaService) {}

  async createCv(userId: string, status: CvStatus) {
    return this.prisma.cv.create({
      data: {
        userId,
        status,
      },
    })
  }

  async findCvById(cvId: string) {
    return this.prisma.cv.findUnique({
      where: { id: cvId },
    })
  }

  async findCvByIdWithSectionsAndChunks(cvId: string) {
    return this.prisma.cv.findUnique({
      where: { id: cvId },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: {
            chunks: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    })
  }

  async findCvsByUserId(userId: string) {
    return this.prisma.cv.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sections: {
          include: {
            _count: {
              select: { chunks: true },
            },
          },
        },
      },
    })
  }

  async updateCvStatus(cvId: string, status: CvStatus) {
    return this.prisma.cv.update({
      where: { id: cvId },
      data: { status },
    })
  }

  async createCvSection(cvId: string, type: CvSectionType, order: number) {
    return this.prisma.cvSection.create({
      data: {
        cvId,
        type,
        order,
      },
    })
  }

  async createCvSections(sections: Array<{ cvId: string; type: CvSectionType; order: number }>) {
    return this.prisma.cvSection.createMany({
      data: sections,
    })
  }

  async createCvChunk(sectionId: string, order: number, content: string) {
    return this.prisma.cvChunk.create({
      data: {
        sectionId,
        order,
        content,
      },
    })
  }

  async createCvChunks(chunks: Array<{ sectionId: string; order: number; content: string }>) {
    return this.prisma.cvChunk.createMany({
      data: chunks,
    })
  }

  async findChunksByCvId(cvId: string) {
    return this.prisma.cvChunk.findMany({
      where: {
        section: {
          cvId,
        },
      },
      include: {
        section: true,
      },
      orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    })
  }

  async findChunksWithoutEmbedding(cvId: string) {
    return this.prisma.cvChunk.findMany({
      where: {
        section: { cvId },
        embedding: null,
      },
    })
  }

  async deleteCv(cvId: string) {
    return this.prisma.cv.delete({
      where: { id: cvId },
    })
  }
}
