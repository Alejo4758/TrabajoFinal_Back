import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const searchATs = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            province,
            department,
            locality, 
            specialties, 
            socialPrograms 
        } = req.query;
        const provinceName = typeof province === 'string' ? province.trim() : '';
        const departmentName = typeof department === 'string' ? department.trim() : '';
        const localityName = typeof locality === 'string' ? locality.trim() : '';

        const pageNumber = Math.max(1, parseInt(page, 10));
        const limitNumber = Math.max(1, parseInt(limit, 10));
        const skip = (pageNumber - 1) * limitNumber;

        // 1. Base del filtro: solo traer perfiles de AT aprobados (opcional pero recomendado)
        const where = {
            status: 'APPROVED' // Si en desarrollo aún están en PENDING, comenta esta línea para probar
        };

        // 2. Filtro geográfico (AT_Locality -> Locality)
        if (provinceName || departmentName || localityName) {
            const localityWhere = {};

            if (provinceName) localityWhere.provinceName = provinceName;
            if (departmentName) localityWhere.departmentName = departmentName;

            if (localityName) {
                const isId = !isNaN(localityName);
                if (isId) {
                    localityWhere.id = parseInt(localityName, 10);
                } else {
                    localityWhere.name = { contains: localityName, mode: 'insensitive' };
                }
            }

            where.localities = {
                some: {
                    locality: localityWhere
                }
            };
        }

        // 3. Filtro por Especialidades (AT_Especiality -> Especiality)
        if (specialties) {
            const specList = specialties.split(',').map(s => s.trim()).filter(Boolean);
            const areIds = specList.every(s => !isNaN(s));

            where.especialities = {
                some: {
                    especiality: areIds
                        ? { id: { in: specList.map(Number) } }
                        : { 
                            OR: specList.map(name => ({
                                name: { contains: name, mode: 'insensitive' }
                            }))
                        }
                }
            };
        }

        // 4. Filtro por Obras Sociales (AT_OSoc -> ObraSocial)
        if (socialPrograms) {
            const osList = socialPrograms.split(',').map(p => p.trim()).filter(Boolean);
            const areIds = osList.every(p => !isNaN(p));

            where.obrasSociales = {
                some: {
                    obraSocial: areIds
                        ? { id: { in: osList.map(Number) } }
                        : { 
                            OR: osList.map(name => ({
                                name: { contains: name, mode: 'insensitive' }
                            }))
                        }
                }
            };
        }

        // 5. Consulta y conteo en paralelo
        const [profiles, total] = await prisma.$transaction([
            prisma.profileAT.findMany({
                where,
                skip,
                take: limitNumber,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            email: true
                        }
                    },
                    localities: {
                        include: { locality: true }
                    },
                    especialities: {
                        include: { especiality: true }
                    },
                    obrasSociales: {
                        include: { obraSocial: true }
                    },
                    availability: {
                        orderBy: { dayOfWeek: 'asc' }
                    }
                },
                orderBy: { id: 'desc' }
            }),
            prisma.profileAT.count({ where })
        ]);

        if (profiles.length === 0) {
            return res.status(404).json({ data: [], message: 'No se encontraron acompañantes terapéuticos' });
        }

        // 6. Formatear la salida para que el Frontend la consuma fácilmente
        const formattedATs = profiles.map(at => ({
            id: at.id,
            userId: at.userId,
            name: at.user.name,
            lastName: at.user.lastName,
            email: at.user.email,
            studies: at.studies,
            genre: at.genre,
            dateOfBirth: at.dateOfBirth,
            status: at.status,
            localities: at.localities.map(l => l.locality.name),
            specialties: at.especialities.map(e => e.especiality.name),
            socialPrograms: at.obrasSociales.map(o => o.obraSocial.name),
            availability: at.availability
        }));

        return res.status(200).json({
            data: formattedATs,
            pagination: {
                total,
                page: pageNumber,
                limit: limitNumber,
                totalPages: Math.ceil(total / limitNumber)
            }
        });

    } catch (error) {
        console.error('Error en searchATs:', error);
        return res.status(500).json({ error: 'Error interno del servidor al filtrar profesionales' });
    }

    
};

export const getATById = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: 'El ID del profesional debe ser un número válido' });
        }

        // Busca por el ID de PerfilAT
        const at = await prisma.profileAT.findFirst({
            where: {
                OR: [
                    { id: id }
                ]
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        email: true
                    }
                },
                localities: { include: { locality: true } },
                especialities: { include: { especiality: true } },
                obrasSociales: { include: { obraSocial: true } },
                experiences: {
                    orderBy: { startDate: 'desc' }
                },
                availability: {
                    orderBy: { dayOfWeek: 'asc' }
                }
            }
        });

        if (!at) {
            return res.status(404).json({ error: `Profesional no encontrado (ID: ${id})` });
        }

        // Extraemos nombres como strings simples (evita que React crashee al renderizar)
        const localitiesNames = (at.localities || []).map(l => l.locality?.name).filter(Boolean);
        const specialtiesNames = (at.especialities || []).map(e => e.especiality?.name).filter(Boolean);
        const socialProgramsNames = (at.obrasSociales || []).map(o => o.obraSocial?.name).filter(Boolean);

        // Objeto compatible tanto si el front busca propiedades planas como anidadas
        const formattedProfile = {
            id: at.id,
            userId: at.userId,
            name: at.user?.name || '',
            lastName: at.user?.lastName || '',
            email: at.user?.email || '',
            // Mantenemos 'user' por si el front hace at.user.name
            user: at.user,
            dateOfBirth: at.dateOfBirth,

            studies: at.studies || '',
            genre: at.genre || '',
            status: at.status,
            // Arrays de strings (igual que en searchATs)
            locality: localitiesNames,
            localities: localitiesNames,
            specialties: specialtiesNames,
            socialPrograms: socialProgramsNames,
            // Alias adicionales por si el front usa los nombres del schema
            especialities: specialtiesNames,
            obrasSociales: socialProgramsNames,
            experiences: at.experiences || [],
            availability: at.availability || []
        };

        return res.status(200).json({ data: formattedProfile });

    } catch (error) {
        console.error('Error en getATById:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// GET /ats/filters-options
export const getFilterOptions = async (req, res) => {
    try {
        const [localities, specialties, socialPrograms] = await prisma.$transaction([
            prisma.locality.findMany({ orderBy: { name: 'asc' } }),
            prisma.especiality.findMany({ orderBy: { name: 'asc' } }),
            prisma.obraSocial.findMany({ orderBy: { name: 'asc' } })
        ]);

        return res.status(200).json({
            data: { localities, specialties, socialPrograms }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error al cargar opciones de filtros' });
    }
};