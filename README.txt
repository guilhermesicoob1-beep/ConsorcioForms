CRM Consórcio

Use Node.js 20 ou superior. Configure as variáveis de ambiente CRM_USER
e CRM_PASSWORD com as credenciais desejadas, e SUPABASE_SERVER_KEY com a
chave secreta do projeto existente. Guarde a chave apenas no servidor.

Execute: node server.mjs
Painel: http://localhost:3000/
Formulário público: http://localhost:3000/?form

Para publicar, use HTTPS e configure CRM_SECURE_COOKIE=1. A porta padrão
é 3000 e pode ser definida pela variável PORT. Para alterar as credenciais
administrativas, atualize as variáveis e reinicie o servidor.

O envio público continua usando a política de inserção da tabela existente.
O login administrativo usa sessão em memória, encerrada ao reiniciar.
