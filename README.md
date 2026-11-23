# TrabajoFinal_Back

paso a paso para levantar la api

npm install

copiar .env.example como .env y completar los valores (GEMINI_API_KEY es opcional: sin ella solo
falla la generación de borradores de informes con IA)

npx prisma generate

npx prisma migrate dev

node scripts/import-localities.js

node .\src\index.js

