
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const API_URL =
  "https://apis.datos.gob.ar/georef/api/localidades?max=5000&campos=estandar";

async function importLocalities() {
  try {
    console.log("Descargando localidades de Georef...");

    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.localidades)) {
      throw new Error("La API no devolvió un listado válido");
    }

    if (data.localidades.length < data.total) {
      throw new Error(
        `Descarga incompleta: ${data.localidades.length} de ${data.total}`
      );
    }

    const localities = data.localidades
      .filter((item) => item.id && item.nombre)
      .map((item) => ({
        georefId: String(item.id),
        name: item.nombre,
        provinceName: item.provincia?.nombre ?? null,
        departmentName: item.departamento?.nombre ?? null,
      }));

    console.log(`Localidades recibidas: ${localities.length}`);

    let inserted = 0;

    for (let i = 0; i < localities.length; i += 500) {
      const batch = localities.slice(i, i + 500);

      const result = await prisma.locality.createMany({
        data: batch,
        skipDuplicates: true,
      });

      inserted += result.count;

      console.log(
        `Procesadas ${Math.min(i + 500, localities.length)} de ${localities.length}`
      );
    }

    console.log(`Importación finalizada. Nuevas localidades: ${inserted}`);
  } catch (error) {
    console.error("Error importando localidades:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

importLocalities();
