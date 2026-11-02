import { describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { BpmExceptionFilter, BpmResponseInterceptor } from './bpm-http.js';
describe('BPM response contracts',()=>{
 it('sets revision ETag while leaving an already-sent authenticated download untouched',async()=>{
  const response={headersSent:false,setHeader:vi.fn()};const context:any={switchToHttp:()=>({getResponse:()=>response})};const interceptor=new BpmResponseInterceptor();await lastValueFrom(interceptor.intercept(context,{handle:()=>of({id:'r',currentVersion:4})}));expect(response.setHeader).toHaveBeenCalledWith('ETag','W/"r:4"');response.setHeader.mockClear();response.headersSent=true;await lastValueFrom(interceptor.intercept(context,{handle:()=>of('download')}));expect(response.setHeader).not.toHaveBeenCalled();
 });
 it('preserves localized field errors under a stable scoped envelope',()=>{
  const response={status:vi.fn().mockReturnThis(),json:vi.fn()};const host:any={switchToHttp:()=>({getResponse:()=>response})};new BpmExceptionFilter().catch(new BadRequestException({code:'FIELD_VALIDATION',fields:{title:'Invalid title'}}),host);expect(response.json).toHaveBeenCalledWith({error:{code:'FIELD_VALIDATION',message:'FIELD_VALIDATION',fields:{title:'Invalid title'}}});
 });
});
