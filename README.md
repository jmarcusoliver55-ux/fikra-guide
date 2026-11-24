# Fikra Guide

*verified work profiles for migrants*

Agente de IA que entrevista o imigrante no idioma dele (espanhol, crioulo haitiano, francês, português, inglês ou árabe), confirma tudo com a pessoa e gera o currículo em **português e inglês**, mais um texto para o LinkedIn. Protótipo para o Create AI Agents Championship (categoria Best Societal AI Agent).

## O que já funciona

1. Escolha de idioma (árabe com leitura da direita para a esquerda).
2. Termo de consentimento e aviso de que a pessoa fala com uma IA.
3. Entrevista por texto ou voz, uma pergunta de cada vez.
4. Resumo no idioma da pessoa, com leitura em voz alta, para ela confirmar ou corrigir.
5. Currículo em PT e EN, com nota "aguardando revisão humana", salvar em PDF e texto do LinkedIn.
6. Botão "Apagar tudo". Nada é salvo em servidor.

**Ainda falta:** a fila de revisão humana (revisor da organização parceira) e o registro de cada aprovação.

## Estrutura

```
public/                 página (HTML, CSS, JS e textos nos 6 idiomas)
netlify/functions/
  agent.mjs             função que chama a API do Claude (guarda a chave)
  prompts.mjs           instruções do agente: perguntas, privacidade, regras de verdade
netlify.toml            configuração do Netlify
.env.example            modelo das variáveis (sem a chave real)
```

## Regra de ouro

**A chave da API nunca vai para o GitHub.** Ela fica só no Netlify, em *Project configuration → Environment variables*, com o nome `ANTHROPIC_API_KEY`. O arquivo `.gitignore` já bloqueia arquivos `.env`.

## Instalação (uma vez)

1. **GitHub:** crie um repositório novo chamado `fikra-guide` (pode ser público). Clique em *uploading an existing file* e arraste **o conteúdo** desta pasta (não a pasta em si). Confirme em *Commit changes*.
2. **Ramo de testes:** no repositório, clique no seletor de ramo (*main*), digite `dev` e escolha *Create branch: dev from main*.
3. **Netlify:** de preferência numa conta **diferente** da que tem o site da Fikra. *Add new project → Import an existing project → GitHub* e escolha `fikra-guide`. Não mude nada nas configurações de build (o `netlify.toml` já cuida disso).
4. **Chave:** em *Project configuration → Environment variables*, adicione `ANTHROPIC_API_KEY` com a chave criada em console.anthropic.com. Defina também um limite de gasto mensal no console da Anthropic.
5. **Testes grátis:** em *Project configuration → Build & deploy → Branches and deploy contexts*, deixe o ramo de produção como `main` e ative *Branch deploys* só para `dev`.

## Como trabalhar sem gastar créditos

No plano grátis do Netlify são 300 créditos por mês, e cada publicação em produção custa 15. Publicações de ramo e de prévia são gratuitas.

- Toda mudança vai para o ramo **`dev`**. O Netlify gera um link de teste do tipo `dev--nome-do-site.netlify.app`, sem gastar créditos de publicação.
- Só leve para **`main`** (produção) quando uma etapa estiver pronta e testada: mais ou menos uma vez por semana.
- Se os créditos acabarem, o Netlify pausa os projetos da conta até o mês seguinte. Por isso o protótipo deve ficar fora da conta do site da Fikra.

## Revisão antes dos testes com pessoas reais

- Textos em **crioulo haitiano e árabe** (`public/i18n.js`) precisam de revisão por falante nativo.
- O termo de consentimento precisa de revisão por alguém que conheça a LGPD.
- Veja o protocolo completo na seção *Normas e conformidade* do documento do projeto.


## Nota sobre a estrutura

A função do agente fica em `netlify/functions/agent/` (agent.mjs e prompts.mjs juntos), para o Netlify reconhecer uma função só.
