-- Compra de material: depois da aprovação, o Suprimentos registra o pedido ao fornecedor e a
-- requisição fica em `aguardando_entrega` até o solicitante confirmar o recebimento.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'aguardando_entrega';
