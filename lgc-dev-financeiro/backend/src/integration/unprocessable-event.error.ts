/**
 * Evento do Core que o Financeiro entendeu, mas não consegue aplicar (ex.: revisão que não existe aqui).
 * Não é erro do remetente nem do servidor: o receptor desfaz o que fez, guarda o evento como `FAILED` com esta
 * mensagem legível e responde 200, para o Core não reentregar em laço. Reprocessa se o Core reenviar.
 */
export class UnprocessableEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnprocessableEventError';
  }
}
