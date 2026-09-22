# Aposentar "item composto"; adotar Ingrediente / Preparo / Produto

O código (has_batch_no + is_stock_item no doctype Item) usava uma única flag para responder três perguntas independentes de um item: se tem rastreio de lote/validade, se foi comprado ou produzido (tem Receita), e se é vendável (aparece no cardápio). "Item composto" tentava cobrir tanto um preparo feito em lote com antecedência (ex: Hambúrguer, a carne grelhada) quanto um produto montado na hora da venda (ex: Burguim Clássico) — dois comportamentos operacionais bem diferentes por trás do mesmo rótulo, causando confusão real no uso (itens "sumindo" de listas, exclusão que não completava).

Decidido (grilling com o dono, 2026-09-22) separar em três termos, definidos em CONTEXT.md, a partir de duas propriedades independentes (Vendável, Rastreio de lote) mais a presença opcional de uma Receita:

- **Ingrediente**: comprado, com rastreio, não vendável.
- **Preparo**: produzido (tem Receita), com rastreio, não vendável.
- **Produto**: vendável — pode ou não ter Receita, pode ou não ter rastreio.

Consequência: um "Produto" comprado pronto (ex: refrigerante revendido) e um "Produto" produzido (Burguim Clássico) são o mesmo tipo do ponto de vista de "aparece no cardápio", divergindo apenas em ter Receita ou não — não são categorias separadas.

Implica reescrever a classificação de itens no código a partir dessas duas propriedades explícitas em vez de inferir tudo de has_batch_no sozinho; a base de dados será recriada do zero (ver decisão paralela de dropar e recriar o banco), então não há migração de dados existentes a considerar.
