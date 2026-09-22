# Remover recursos de restaurante completo (salão, agregador, multi-filial)

O Burguim nasceu do template URY, feito para restaurante completo: salão com mesas, captain, múltiplas filiais e integração com agregadores de entrega (iFood, Rappi). Confirmado com o dono (2026-09-22): o Burguim atende só por Retirada e Entrega — sem salão nem mesa —, opera uma única filial sem planos de expandir, e não usa nem pretende usar agregadores externos.

Decidido remover esses recursos da interface em vez de mantê-los desativados/escondidos por trás de uma flag: Mesa, Sala, Captain, o seletor/criação de múltiplas filiais, e Agregador. Objetivo explícito é manter o projeto e a interface enxutos, não preservar opcionalidade pra um cenário sem planos concretos de acontecer.

Perfil de POS continua existindo (necessário pro POS funcionar), simplificado para não exigir escolha entre vários.
