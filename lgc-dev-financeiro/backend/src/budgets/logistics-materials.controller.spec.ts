import { BadRequestException } from '@nestjs/common';
import type { LogisticsClient } from '../cost-centers/logistics.client.js';
import { LogisticsMaterialsController } from './logistics-materials.controller.js';

/** Rota interna de consulta ao catálogo da Logística: validação dos parâmetros. */

function setup() {
  const logistics = { searchMaterials: vi.fn().mockResolvedValue([]), materialsByCodes: vi.fn().mockResolvedValue([]) };
  return { logistics, controller: new LogisticsMaterialsController(logistics as unknown as LogisticsClient) };
}

describe('LogisticsMaterialsController', () => {
  it('search usa a busca por texto; code usa a consulta por código exato', async () => {
    const { controller, logistics } = setup();
    await controller.find(' cabo ');
    expect(logistics.searchMaterials).toHaveBeenCalledWith('cabo');
    await controller.find(undefined, 'RED-CAB-0123');
    expect(logistics.materialsByCodes).toHaveBeenCalledWith(['RED-CAB-0123']);
  });

  it('search e code juntos, ou search curto demais, ou nada → 400 sem chamar a Logística', () => {
    const { controller, logistics } = setup();
    expect(() => controller.find('cabo', 'RED-CAB-0123')).toThrow(BadRequestException);
    expect(() => controller.find('a')).toThrow('ao menos 2 caracteres');
    expect(() => controller.find()).toThrow(BadRequestException);
    expect(() => controller.find(undefined, 'x')).toThrow(BadRequestException);
    expect(logistics.searchMaterials).not.toHaveBeenCalled();
    expect(logistics.materialsByCodes).not.toHaveBeenCalled();
  });
});
