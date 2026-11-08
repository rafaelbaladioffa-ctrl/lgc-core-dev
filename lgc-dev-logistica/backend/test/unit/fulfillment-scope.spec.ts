import { describe, expect, it } from 'vitest';
import { isOwnOrder, ownOrdersWhere } from '../../src/fulfillment/fulfillment.service.js';

// O Core envia `recipient_id` como id de colaborador; o token traz o id de usuário em `sub` e o colaborador em `collaboratorId`.
const USER = 'b2bd7920-user';
const COLLAB = 'f7331fe1-collab';

describe('escopo das ordens de atendimento para quem só tem fulfillment:read', () => {
  it('destinatário enviado como colaborador enxerga a ordem', () => {
    expect(isOwnOrder({ requesterAxisId: null, recipientAxisId: COLLAB }, { userId: USER, collaboratorId: COLLAB })).toBe(true);
  });

  it('solicitante e destinatário pelo id de usuário continuam valendo', () => {
    expect(isOwnOrder({ requesterAxisId: USER, recipientAxisId: null }, { userId: USER, collaboratorId: null })).toBe(true);
    expect(isOwnOrder({ requesterAxisId: null, recipientAxisId: USER }, { userId: USER, collaboratorId: COLLAB })).toBe(true);
  });

  it('ordem de outra pessoa continua fora', () => {
    expect(isOwnOrder({ requesterAxisId: 'outro', recipientAxisId: 'outro-collab' }, { userId: USER, collaboratorId: COLLAB })).toBe(false);
    expect(isOwnOrder({ requesterAxisId: null, recipientAxisId: null }, { userId: USER, collaboratorId: null })).toBe(false);
  });

  it('o filtro da lista usa os mesmos ids', () => {
    expect(ownOrdersWhere({ userId: USER, collaboratorId: COLLAB })).toEqual({ OR: [{ requesterAxisId: USER }, { recipientAxisId: { in: [USER, COLLAB] } }] });
    expect(ownOrdersWhere({ userId: USER, collaboratorId: null })).toEqual({ OR: [{ requesterAxisId: USER }, { recipientAxisId: { in: [USER] } }] });
  });
});
