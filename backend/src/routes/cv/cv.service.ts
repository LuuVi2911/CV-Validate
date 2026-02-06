import { Injectable } from '@nestjs/common'
import { CvRepo } from './cv.repo'
import { CvStatus, CvSectionType } from 'src/generated/prisma/enums'
import { PdfTextService } from 'src/shared/services/pdf-text.service'
import { CvSectioningService } from 'src/shared/services/cv-sectioning.service'
import { CvChunkingService } from 'src/shared/services/cv-chunking.service'
import {
  CvNotFoundException,
  CvNotOwnedException,
  CvNotParsedYetException,
  CvPdfUnreadableException,
  CvPdfEmptyTextException,
  CvNoChunksException,
} from './cv.error'

@Injectable()
export class CvService {
  constructor(
    private readonly cvRepo: CvRepo,
    private readonly pdfTextService: PdfTextService,
    private readonly cvSectioningService: CvSectioningService,
    private readonly cvChunkingService: CvChunkingService,
  ) {}

  async uploadCv(userId: string, file: Express.Multer.File) {
    const cv = await this.cvRepo.createCv(userId, CvStatus.UPLOADED)

    try {
      // Parse PDF to text
      let rawText: string
      try {
        rawText = await this.pdfTextService.extractText(file.buffer)
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'PDF_EMPTY_TEXT') {
            throw CvPdfEmptyTextException
          }
          if (error.message === 'PDF_UNREADABLE') {
            throw CvPdfUnreadableException
          }
        }
        throw CvPdfUnreadableException
      }

      // Detect sections
      const detectedSections = this.cvSectioningService.detectSections(rawText)

      // Create chunks
      const chunkData = this.cvChunkingService.createChunks(detectedSections)

      if (chunkData.length === 0) {
        throw CvNoChunksException
      }

      // Persist sections
      const sectionMap = new Map<number, string>() // order -> sectionId
      for (const section of detectedSections) {
        const createdSection = await this.cvRepo.createCvSection(cv.id, section.type as CvSectionType, section.order)
        sectionMap.set(section.order, createdSection.id)
      }

      // Persist chunks
      const chunksToCreate = chunkData.map((chunk) => ({
        sectionId: sectionMap.get(chunk.sectionOrder)!,
        order: chunk.order,
        content: chunk.content,
      }))
      await this.cvRepo.createCvChunks(chunksToCreate)

      await this.cvRepo.updateCvStatus(cv.id, CvStatus.PARSED)

      return {
        cvId: cv.id,
        status: CvStatus.PARSED,
      }
    } catch (error) {
      await this.cvRepo.deleteCv(cv.id)
      throw error
    }
  }

  async getCvById(userId: string, cvId: string) {
    const cv = await this.cvRepo.findCvByIdWithSectionsAndChunks(cvId)

    if (!cv) {
      throw CvNotFoundException
    }

    if (cv.userId !== userId) {
      throw CvNotOwnedException
    }

    return {
      id: cv.id,
      userId: cv.userId,
      status: cv.status,
      createdAt: cv.createdAt,
      sections: cv.sections.map((section) => ({
        id: section.id,
        cvId: section.cvId,
        type: section.type,
        order: section.order,
        chunks: section.chunks.map((chunk) => ({
          id: chunk.id,
          sectionId: chunk.sectionId,
          order: chunk.order,
          content: chunk.content,
        })),
      })),
    }
  }

  async listCvs(userId: string) {
    const cvs = await this.cvRepo.findCvsByUserId(userId)

    return {
      cvs: cvs.map((cv) => ({
        id: cv.id,
        status: cv.status,
        createdAt: cv.createdAt,
        sectionCount: cv.sections.length,
        chunkCount: cv.sections.reduce((acc, section) => acc + section._count.chunks, 0),
      })),
    }
  }

  async ensureCvParsed(userId: string, cvId: string) {
    const cv = await this.cvRepo.findCvById(cvId)

    if (!cv) {
      throw CvNotFoundException
    }

    if (cv.userId !== userId) {
      throw CvNotOwnedException
    }

    if (cv.status !== CvStatus.PARSED && cv.status !== CvStatus.EVALUATED) {
      throw CvNotParsedYetException
    }

    return cv
  }

  async deleteCv(userId: string, cvId: string) {
    const cv = await this.cvRepo.findCvById(cvId)

    if (!cv) {
      throw CvNotFoundException
    }

    if (cv.userId !== userId) {
      throw CvNotOwnedException
    }

    await this.cvRepo.deleteCv(cvId)

    return { message: 'CV deleted successfully' }
  }
}
