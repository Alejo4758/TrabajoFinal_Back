import { PrismaClient, Role, StatusAT } from '@prisma/client';
import * as bcrypt from 'bcrypt'; // Si no usas bcrypt aún, puedes poner un string fijo en password

const prisma = new PrismaClient();

async function findOrCreateByName(model, name) {
  const existing = await model.findFirst({ where: { name } });
  return existing ?? model.create({ data: { name } });
}

async function main() {
  console.log('🌱 Iniciando carga de datos de prueba...');

  // 2. Crear Localidades
  const neuquen = await findOrCreateByName(prisma.locality, 'Neuquén Capital');
  const cipolletti = await findOrCreateByName(prisma.locality, 'Cipolletti');
  const plottier = await findOrCreateByName(prisma.locality, 'Plottier');
  const centenario = await findOrCreateByName(prisma.locality, 'Centenario');

  // 3. Crear Especialidades
  const tea = await findOrCreateByName(prisma.especiality, 'Trastorno del Espectro Autista (TEA)');
  const adultosMayores = await findOrCreateByName(prisma.especiality, 'Adultos Mayores / Gerontología');
  const escolar = await findOrCreateByName(prisma.especiality, 'Integración Escolar');
  const saludMental = await findOrCreateByName(prisma.especiality, 'Salud Mental y Adicciones');

  // 4. Crear Obras Sociales
  const issn = await findOrCreateByName(prisma.obraSocial, 'ISSN');
  const osde = await findOrCreateByName(prisma.obraSocial, 'OSDE');
  const swiss = await findOrCreateByName(prisma.obraSocial, 'Swiss Medical');
  const pami = await findOrCreateByName(prisma.obraSocial, 'PAMI');

  // Contraseña encriptada genérica ("123456") para todos los usuarios de prueba
  const hashedPassword = await bcrypt.hash('123456', 10);

  // 5. Crear ATs con sus relaciones anidadas
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
      especialities: [tea.id, escolar.id],
      obrasSociales: [issn.id, osde.id],
      experiences: [
        {
          title: 'Acompañamiento Escolar en Nivel Primario',
          startDate: new Date('2022-03-01'),
          finishDate: new Date('2024-12-15'),
          description: 'Acompañamiento e integración áulica para niños con TEA.'
        }
      ],
      availability: [
        { dayOfWeek: 1, startTime: '08:00', endTime: '13:00' }, // Lunes
        { dayOfWeek: 3, startTime: '08:00', endTime: '13:00' }, // Miércoles
        { dayOfWeek: 5, startTime: '08:00', endTime: '13:00' }  // Viernes
      ]
    },
    {
      email: 'martin.perez@test.com',
      name: 'Martín',
      lastName: 'Pérez',
      documentNumber: '38333444',
      dateOfBirth: new Date('1994-09-20'),
      studies: 'Licenciatura en Psicología (en curso) + Curso AT',
      genre: 'Masculino',
      localities: [neuquen.id, cipolletti.id],
      especialities: [saludMental.id, adultosMayores.id],
      obrasSociales: [issn.id, pami.id, swiss.id],
      experiences: [
        {
          title: 'AT Domiciliario Adultos Mayores',
          startDate: new Date('2021-06-01'),
          description: 'Estimulación cognitiva y acompañamiento en rutinas diarias.'
        }
      ],
      availability: [
        { dayOfWeek: 2, startTime: '14:00', endTime: '20:00' }, // Martes
        { dayOfWeek: 4, startTime: '14:00', endTime: '20:00' }  // Jueves
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
      localities: [centenario.id, neuquen.id],
      especialities: [tea.id, saludMental.id],
      obrasSociales: [osde.id, swiss.id],
      experiences: [
        {
          title: 'Centro de Día Esperanza',
          startDate: new Date('2023-01-10'),
          description: 'Coordinación de talleres grupales y contención.'
        }
      ],
      availability: [
        { dayOfWeek: 1, startTime: '15:00', endTime: '19:00' },
        { dayOfWeek: 2, startTime: '15:00', endTime: '19:00' },
        { dayOfWeek: 3, startTime: '15:00', endTime: '19:00' }
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
          emailVerified: true,
          verificationToken: null,
          tokenExpiresAt: null
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

  console.log('✅ ¡Datos de prueba cargados correctamente!');
}

main()
  .catch((e) => {
    console.error('❌ Error cargando datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });