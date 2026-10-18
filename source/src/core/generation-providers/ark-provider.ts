import { ArkAdapter, getArkConfig } from '@/core/adapters/ark-adapter';
import { createServerOnlyFn } from '@tanstack/react-start';
import { ARK_DEFAULT_MODEL, buildArkTaskRequest } from '@/core/adapters/ark-contract';
import type { GenerationProviderDefinition } from './contracts';
import { CompatibleImageAdapter } from '@/core/adapters/compatible-image-adapter';
import { compatibleImageInputSchema } from '@/core/adapters/compatible-image-contract';
import { resolveConnection } from './connection-store';
import { ConfiguredVideoAdapter } from '@/core/adapters/configured-video-adapter';
import { configuredVideoInputSchema,buildConfiguredVideoRequest } from '@/core/adapters/configured-video-contract';

export const arkGenerationProvider: GenerationProviderDefinition = {
  id: 'ark', label: 'Local model connections', supports: ['video','image'],
  modelBindings: [{ modelId: 'seedance-2.5', effectId: 18, upstreamModelId: ARK_DEFAULT_MODEL, uploadPath: 'effects/seedance-2-5', imageBucketName: 'local' },{modelId:'configured-video',effectId:1001,upstreamModelId:'configured-video',uploadPath:'effects/configured-video',imageBucketName:'local'},{modelId:'configured-image',effectId:1002,upstreamModelId:'configured-image',uploadPath:'effects/configured-image',imageBucketName:'local'}],
  createAdapter: createServerOnlyFn((effect) => effect.type===2?new CompatibleImageAdapter(effect):new ConfiguredVideoAdapter(effect)),
  assertConfigured: createServerOnlyFn(async (effect,input) => {
    const profile=await resolveConnection(effect?.type===2?'image':'video',typeof input?.connectionId==='string'?input.connectionId:undefined);
    if (!profile.demo && !profile.apiKey) throw new Error('Configure an API Key for this model connection in Settings.');
    if(effect?.type!==2&&input)buildConfiguredVideoRequest(input,profile);
  }),
  validateInput: (effect, input) => {
    if(effect.type===2){
      if(Array.isArray(input.image_urls)&&input.image_urls.length)throw new Error('This image protocol currently supports text-to-image only. Reference editing requires a separate image-edit adapter.');
      compatibleImageInputSchema.parse(input);
    }else if(effect.id===1001)configuredVideoInputSchema.parse(input);
    else buildArkTaskRequest(input);
  },
};
