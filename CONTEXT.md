# Burguim

Sistema de pedidos e operação de uma hamburgueria que atende por retirada e entrega — sem salão, mesa ou atendimento presencial no local. Construído sobre o template URY (multi-restaurante, com salão/mesa/captain/múltiplas filiais); este documento existe pra registrar o que se aplica à realidade do Burguim e nomear as coisas do jeito que fazem sentido aqui, não do jeito que o URY genérico assume.

## Language

**Pedido**:
Uma solicitação de compra feita por um Cliente — criada por ele mesmo via autoatendimento (site) ou lançada manualmente por um funcionário — sempre vinculada a um Cliente identificável. Tem uma Modalidade (Retirada ou Entrega) definida na criação, que determina por quais Estados ele passa.
_Avoid_: Order

### Estados do Pedido

Todo Pedido começa em **Na fila** (aguardando início do preparo) e passa para **Preparando** (a cozinha está montando). Depois disso, os estados divergem por Modalidade:

**Pronto para retirada** → **Retirado**:
Estados exclusivos de um Pedido de Retirada — primeiro fica pronto aguardando o Cliente, depois é marcado como retirado quando ele busca.

**Saiu para entrega** → **Entregue**:
Estados exclusivos de um Pedido de Entrega — primeiro é despachado, depois marcado como entregue ao chegar no Cliente.

**Cliente**:
Uma pessoa que faz Pedidos, identificada pelo telefone — sem conta ou login. Nome, endereço e telefone ficam salvos e são reconhecidos automaticamente a cada novo Pedido com o mesmo telefone, o que forma o histórico (frequência, itens pedidos, dia da semana) usado pra identificar clientes recorrentes.
_Avoid_: Customer, comprador

**Retirada**:
Modalidade de atendimento em que o Cliente busca o Pedido pronto no local — não existe salão, mesa ou consumo no local.
_Avoid_: Pickup, balcão

**Entrega**:
Modalidade de atendimento em que o Pedido é levado até o Cliente depois de pronto.
_Avoid_: Delivery

### Tipos de item

Todo item tem duas propriedades independentes — se é **Vendável** (aparece no cardápio, tem preço de venda) e se tem **Rastreio de lote** (controle de lote/validade) — e pode ou não ter uma **Receita** vinculada (o que o torna "produzido" em vez de "comprado" de um fornecedor). Não são três categorias fixas; são combinações dessas propriedades, e três combinações cobrem os casos reais do negócio:

**Ingrediente**:
Comprado de fornecedor, sem Receita, com Rastreio de lote, não Vendável — nunca aparece sozinho no cardápio, só como componente de uma Receita. Ex: alface, pão, maionese.
_Avoid_: Item composto (termo antigo, ambíguo — misturava Preparo e Produto)

**Preparo**:
Produzido (tem Receita), com Rastreio de lote, não Vendável — feito em lote com antecedência, só usado como componente de outro item. Ex: Hambúrguer (a carne grelhada, preparada de manhã).
_Avoid_: Item composto (termo antigo, ambíguo)

**Produto**:
Vendável — aparece no cardápio com preço de venda. Pode ou não ter Receita (ex: Burguim Clássico é produzido e montado na hora, sem lote próprio) e pode ou não ter Rastreio de lote (ex: um refrigerante comprado pronto e revendido, com lote controlado, criado direto ao registrar a compra no estoque).
_Avoid_: Item composto (termo antigo, ambíguo)

**Receita**:
A fórmula de quais outros itens (Ingredientes, Preparos, ou até outros Produtos) compõem um item e em que quantidade. Ter ou não uma Receita é o que diferencia um item "produzido" de um "comprado".
_Avoid_: BOM, fórmula

**Pagamento**:
Acontece na Retirada ou na Entrega — dinheiro, cartão ou PIX no momento. Não existe pagamento antecipado pelo site nem conta corrente de Cliente (fiado).
_Avoid_: checkout, pagamento online

**Categoria**:
Um agrupamento de Produtos no Cardápio (ex: Lanches, Bebidas, Sobremesas) — criável e editável (nome, ícone) pelo Dono.
_Avoid_: Course, seção

**Cupom de Desconto**:
Um código que aplica um desconto — percentual ou valor fixo — no Pedido inteiro. Informado pelo Cliente no site ou passado ao Caixa num Pedido manual. Tem data de validade e um teto de usos totais; cada Cliente só pode usar um mesmo Cupom uma vez. Uso típico: o Dono cria um Cupom pra um Cliente específico, que usa uma única vez.
_Avoid_: Coupon, desconto, promoção

### Papéis

**Dono**:
Acesso total ao sistema — cardápio, estoque, relatórios, configurações.
_Avoid_: Admin, gerente

**Caixa**:
Vê a fila de Pedidos e cria Pedidos novos manualmente (quando o Cliente pede por telefone, por exemplo), além de consultar o histórico de Pedidos já concluídos (Retirados/Entregues) de dias anteriores. Sem acesso a cardápio/estoque/configurações.
_Avoid_: Cashier

**Tela de Cozinha**:
Uma visão simplificada e isolada (aberta numa aba separada, sem nenhum outro menu de navegação) da fila de Pedidos, ordenada, mostrando o tempo decorrido de cada um e permitindo mudar o Estado de um Pedido. Não é um papel/login separado — Dono e Caixa acessam ela através de um ícone que abre essa tela numa aba nova. Não existe login próprio de "cozinha".
_Avoid_: Kitchen display, KOT (o URY usa esse termo pra outra coisa - ticket impresso)
