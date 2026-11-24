# TrabajoFinal_Back

paso a paso para levantar la api

npm install

copiar .env.example como .env y completar los valores (GEMINI_API_KEY es opcional: sin ella solo
falla la generación de borradores de informes con IA). FRONTEND_URL es la URL del front que va en los enlaces
de los correos (la invitación a la red de apoyo es ${FRONTEND_URL}/invitacion/<token>); por defecto http://localhost:5173

npx prisma generate

npx prisma migrate dev

node scripts/import-localities.js

node .\src\index.js

