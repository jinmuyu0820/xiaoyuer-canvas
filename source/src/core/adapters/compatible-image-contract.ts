import { z } from 'zod';
export const compatibleImageInputSchema=z.object({prompt:z.string().trim().min(1).max(20000),connectionId:z.string().optional(),wmWorkflowTemplateId:z.string().optional(),wmBatchIndex:z.number().optional(),wmBatchTotal:z.number().optional()}).strict();
