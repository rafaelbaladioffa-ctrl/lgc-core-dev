import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { map } from 'rxjs';
@Catch(HttpException)
export class BpmExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const status = exception.getStatus(); const payload = exception.getResponse();
    const body = typeof payload === 'string' ? {message:payload} : payload as { code?:string;message?:string|string[];fields?:Record<string,string>;errors?:Array<{path?:string;message?:string}> };
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message ?? body.errors?.[0]?.message ?? body.code ?? 'Operação não concluída';
    const code = body.code ?? (/^[A-Z_]+$/.test(message) ? message : status===409?'VERSION_CONFLICT':status===403?'FORBIDDEN':status===404?'NOT_FOUND':'VALIDATION_ERROR');
    host.switchToHttp().getResponse().status(status).json({error:{code,message,...(body.fields?{fields:body.fields}:{}),...(body.errors?{errors:body.errors}:{})}});
  }
}
@Injectable()
export class BpmResponseInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler) {
    const response=context.switchToHttp().getResponse();
    return next.handle().pipe(map(result=>{
      if (response.headersSent) return result;
      response.setHeader('Cache-Control','private, no-store');
      const revision=result?.currentVersion ?? result?.bpmRevision ?? result?.configRevision;
      if(Number.isInteger(revision))response.setHeader('ETag',`W/"${result.id ?? result.requestId ?? 'bpm'}:${revision}"`);
      return result;
    }));
  }
}
