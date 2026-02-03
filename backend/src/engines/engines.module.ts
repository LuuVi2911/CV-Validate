import { Module } from '@nestjs/common'
import { CvQualityEngine } from './cv-quality/cv-quality.engine'
import { JdMatchingEngine } from './jd-matching/jd-matching.engine'
import { SemanticEvaluator } from './semantic/semantic-evaluator'
import { GapDetector } from './gap-detector'
import { SuggestionGenerator } from './suggestion-generator'
import { StructuralDetectors } from './structural/structural-detectors'
import { CvModule } from 'src/routes/cv/cv.module'
import { JdModule } from 'src/routes/jd/jd.module'

@Module({
  imports: [CvModule, JdModule],
  providers: [
    CvQualityEngine,
    JdMatchingEngine,
    SemanticEvaluator,
    GapDetector,
    SuggestionGenerator,
    StructuralDetectors,
  ],
  exports: [
    CvQualityEngine,
    JdMatchingEngine,
    SemanticEvaluator,
    GapDetector,
    SuggestionGenerator,
    StructuralDetectors,
  ],
})
export class EnginesModule {}
