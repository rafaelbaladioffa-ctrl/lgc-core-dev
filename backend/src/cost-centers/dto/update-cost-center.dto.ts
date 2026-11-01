import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateCostCenterDto } from './create-cost-center.dto.js';

// parentCostCenterId is deliberately excluded — same reasoning as UpdateSectorDto: reparenting
// would require recomputing the hierarchical code for this node and all its descendants.
export class UpdateCostCenterDto extends PartialType(OmitType(CreateCostCenterDto, ['parentCostCenterId'] as const)) {}
