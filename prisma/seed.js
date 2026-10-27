import { PrismaClient, Role, StatusAT } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function findOrCreateByName(model, name) {
  const existing = await model.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } }
  });
  return existing ?? model.create({ data: { name } });
}

// Consulta a Georef AR por ID y guarda todos los campos exactos de tu schema
async function ensureGeorefLocality(georefId, fallbackName, fallbackProv, fallbackDept) {
  // 1. Buscar si ya existe por su código Georef único
  const existing = await prisma.locality.findUnique({
    where: { georefId: georefId }
  });

  if (existing) {
    console.log(`📍 Localidad existente: "${existing.name}" (Provincia: ${existing.provinceName})`);
    return existing;
  }

  let officialName = fallbackName;
  let officialProv = fallbackProv;
  let officialDept = fallbackDept;

  // 2. Traer datos reales de Georef AR (Localidad, Provincia, Departamento)
  try {
    const res = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?id=${georefId}&campos=id,nombre,provincia.nombre,departamento.nombre`);
    if (res.ok) {
      const json = await res.json();
      if (json.localidades && json.localidades.length > 0) {
        const loc = json.localidades[0];
        officialName = loc.nombre;
        officialProv = loc.provincia.nombre;
        officialDept = loc.departamento.nombre;
      }
    }
  } catch (err) {
    console.warn(`⚠️ Sin conexión a Georef, usando datos de respaldo para ${fallbackName}`);
  }

  // 3. Crear usando los nombres exactos de tus columnas (provinceName, departmentName)
  const created = await prisma.locality.create({
    data: { 
      name: officialName,
      georefId: georefId,
      provinceName: officialProv,
      departmentName: officialDept
    }
  });

  console.log(`✅ Creada: "${created.name}" | Depto: ${created.departmentName} | Prov: ${created.provinceName}`);
  return created;
}

async function main() {
  console.log('🌱 Iniciando carga de datos de prueba con Georef AR...');

  // 1. Limpiar localidades viejas que no tengan GeorefId (las que causaban los nulls)
  await prisma.locality.deleteMany({
    where: { georefId: null }
  });

  // 2. Asegurar Localidades completas (Neuquén y Río Negro)
  const neuquen     = await ensureGeorefLocality('58035070', 'Neuquén', 'Neuquén', 'Confluencia');
  const plottier    = await ensureGeorefLocality('58035100', 'Plottier', 'Neuquén', 'Confluencia');
  const centenario  = await ensureGeorefLocality('58035020', 'Centenario', 'Neuquén', 'Confluencia');
  const senillosa   = await ensureGeorefLocality('58035110', 'Senillosa', 'Neuquén', 'Confluencia');
  const cipolletti  = await ensureGeorefLocality('62042080', 'Cipolletti', 'Río Negro', 'General Roca');
  const cincoSaltos = await ensureGeorefLocality('62042070', 'Cinco Saltos', 'Río Negro', 'General Roca');
  const generalRoca = await ensureGeorefLocality('62042190', 'General Roca', 'Río Negro', 'General Roca');

  // 3. Crear Especialidades
  const tea = await findOrCreateByName(prisma.especiality, 'Trastorno del Espectro Autista (TEA)');
  const adultosMayores = await findOrCreateByName(prisma.especiality, 'Adultos Mayores / Gerontología');
  const escolar = await findOrCreateByName(prisma.especiality, 'Integración Escolar');
  const saludMental = await findOrCreateByName(prisma.especiality, 'Salud Mental y Adicciones');
  const ninez = await findOrCreateByName(prisma.especiality, 'Niñez y Adolescencia');
  const discapacidad = await findOrCreateByName(prisma.especiality, 'Discapacidad Motora e Intelectual');

  // 4. Crear Obras Sociales
  const issn = await findOrCreateByName(prisma.obraSocial, 'ISSN');
  const ipross = await findOrCreateByName(prisma.obraSocial, 'IPROSS');
  const osde = await findOrCreateByName(prisma.obraSocial, 'OSDE');
  const swiss = await findOrCreateByName(prisma.obraSocial, 'Swiss Medical');
  const pami = await findOrCreateByName(prisma.obraSocial, 'PAMI');
  const medife = await findOrCreateByName(prisma.obraSocial, 'Medifé');

  const hashedPassword = await bcrypt.hash('123456', 10);

  // 5. Perfiles de prueba
  const atsData = [
    {
      email: 'laura.gomez@test.com',
      name: 'Laura',
      lastName: 'Gómez',
      documentNumber: '35111222',
      dateOfBirth: new Date('1990-05-15'),
      studies: 'Tecnicatura Superior en Acompañamiento Terapéutico',
      genre: 'Femenino',
      localities: [neuquen.id, plottier.id],
      especialities: [tea.id, escolar.id, ninez.id],
      obrasSociales: [issn.id, osde.id],
      experiences: [
        {
          title: 'Acompañamiento Escolar en Nivel Primario',
          startDate: new Date('2022-03-01'),
          finishDate: new Date('2024-12-15'),
          description: 'Acompañamiento e integración áulica para niños con TEA en Neuquén y Plottier.'
        }
      ],
      availability: [
        { dayOfWeek: 1, startTime: '08:00', endTime: '13:00' },
        { dayOfWeek: 3, startTime: '08:00', endTime: '13:00' }
      ]
    },
    {
      email: 'martin.perez@test.com',
      name: 'Martín',
      lastName: 'Pérez',
      documentNumber: '38333444',
      dateOfBirth: new Date('1994-09-20'),
      studies: 'Licenciatura en Psicología (en curso)',
      genre: 'Masculino',
      localities: [neuquen.id, cipolletti.id, cincoSaltos.id],
      especialities: [saludMental.id, adultosMayores.id],
      obrasSociales: [issn.id, ipross.id, pami.id, swiss.id],
      experiences: [
        {
          title: 'AT Domiciliario Adultos Mayores',
          startDate: new Date('2021-06-01'),
          description: 'Estimulación cognitiva en Cipolletti y Neuquén.'
        }
      ],
      availability: [
        { dayOfWeek: 2, startTime: '14:00', endTime: '20:00' },
        { dayOfWeek: 4, startTime: '14:00', endTime: '20:00' }
      ]
    },
    {
      email: 'sofia.martinez@test.com',
      name: 'Sofía',
      lastName: 'Martínez',
      documentNumber: '40555666',
      dateOfBirth: new Date('1997-11-10'),
      studies: 'Técnica Universitaria en Acompañamiento Terapéutico',
      genre: 'Femenino',
      localities: [centenario.id, neuquen.id, cincoSaltos.id],
      especialities: [tea.id, saludMental.id],
      obrasSociales: [osde.id, swiss.id, medife.id],
      experiences: [
        {
          title: 'Centro de Día Esperanza',
          startDate: new Date('2023-01-10'),
          description: 'Coordinación de talleres grupales en Centenario.'
        }
      ],
      availability: [
        { dayOfWeek: 1, startTime: '15:00', endTime: '19:00' },
        { dayOfWeek: 2, startTime: '15:00', endTime: '19:00' }
      ]
    },
    {
      email: 'lucas.fernandez@test.com',
      name: 'Lucas',
      lastName: 'Fernández',
      documentNumber: '36777888',
      dateOfBirth: new Date('1992-03-25'),
      studies: 'Acompañante Terapéutico Certificado',
      genre: 'Masculino',
      localities: [plottier.id, senillosa.id],
      especialities: [discapacidad.id, escolar.id],
      obrasSociales: [issn.id, pami.id],
      experiences: [
        {
          title: 'Asistencia Domiciliaria y Rehabilitación',
          startDate: new Date('2020-08-01'),
          description: 'Acompañamiento terapéutico en Plottier y Senillosa.'
        }
      ],
      availability: [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
        { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' }
      ]
    }
  ];

  for (const at of atsData) {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: at.email },
        update: {
          password: hashedPassword,
          name: at.name,
          lastName: at.lastName,
          documentType: 'DNI',
          documentNumber: at.documentNumber,
          role: Role.AT,
          emailVerified: true
        },
        create: {
          email: at.email,
          password: hashedPassword,
          name: at.name,
          lastName: at.lastName,
          documentType: 'DNI',
          documentNumber: at.documentNumber,
          role: Role.AT,
          emailVerified: true
        }
      });

      const localityLinks = at.localities.map((localityId) => ({ localityId }));
      const specialityLinks = at.especialities.map((especialityId) => ({ especialityId }));
      const socialProgramLinks = at.obrasSociales.map((obraSocialId) => ({ obraSocialId }));

      await tx.profileAT.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          dateOfBirth: at.dateOfBirth,
          studies: at.studies,
          genre: at.genre,
          status: StatusAT.APPROVED,
          localities: { create: localityLinks },
          especialities: { create: specialityLinks },
          obrasSociales: { create: socialProgramLinks },
          experiences: { create: at.experiences },
          availability: { create: at.availability }
        },
        update: {
          dateOfBirth: at.dateOfBirth,
          studies: at.studies,
          genre: at.genre,
          status: StatusAT.APPROVED,
          localities: { deleteMany: {}, create: localityLinks },
          especialities: { deleteMany: {}, create: specialityLinks },
          obrasSociales: { deleteMany: {}, create: socialProgramLinks },
          experiences: { deleteMany: {}, create: at.experiences },
          availability: { deleteMany: {}, create: at.availability }
        }
      });
    });
  }

  console.log('✅ ¡Datos de prueba de ATs vinculados correctamente a Georef!');
}

main()
  .catch((e) => {
    console.error('❌ Error cargando datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });