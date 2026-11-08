import { createHash } from 'crypto';
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Mesmo limite dos anexos do Core. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Baixa documentos do projeto no Core (SOW, Bid Template) pela API de integração, com a API key do
 * satélite (`AXIS_API_KEY`). O Core só responde se o Financeiro assinar `project.document_added`
 * (integracao-core-financeiro §4). Confere o SHA-256 com o que veio no pedido de cotação.
 */
@Injectable()
export class CoreDocumentsClient {
  private readonly logger = new Logger(CoreDocumentsClient.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl() {
    return (this.config.get<string>('AXIS_API_URL') || 'http://localhost:3000/api/v1').replace(/\/+$/, '');
  }

  async download(axisProjectId: string, documentId: string, expectedSha256: string | null, fetchFn: typeof fetch = fetch): Promise<Buffer> {
    const apiKey = this.config.get<string>('AXIS_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('AXIS_API_KEY não configurada: o Financeiro não consegue baixar documentos do Axis Core.');
    const path = `/integration/projects/${encodeURIComponent(axisProjectId)}/documents/${encodeURIComponent(documentId)}/content`;
    let res: Response;
    try {
      res = await fetchFn(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.logger.error(`Core indisponível ao baixar documento ${documentId}: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Não foi possível falar com o Axis Core. Tente novamente em instantes.');
    }
    if (res.status === 401) throw new BadGatewayException('O Axis Core recusou a API key do Financeiro. Confira AXIS_API_KEY.');
    if (res.status === 403) throw new BadGatewayException('O Axis Core recusou o download: o satélite Financeiro precisa assinar project.document_added.');
    if (res.status === 404) throw new BadGatewayException('O documento não existe mais no Axis Core.');
    if (!res.ok) throw new BadGatewayException(`O Axis Core respondeu ${res.status} ao baixar o documento.`);
    const content = Buffer.from(await res.arrayBuffer());
    if (content.length > MAX_BYTES) throw new BadGatewayException('O documento baixado do Axis Core passa de 25MB.');
    const hash = createHash('sha256').update(content).digest('hex');
    if (expectedSha256 && hash !== expectedSha256) {
      throw new BadGatewayException('O documento baixado do Axis Core não confere com a versão do pedido de cotação (hash diferente).');
    }
    return content;
  }
}
