import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getLocalities = async (req, res) => {
    try {
        const province = typeof req.query.province === 'string' ? req.query.province.trim() : '';
        const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';

        if (department && !province) {
            return res.status(400).json({
                error: 'Debe indicar una provincia para filtrar por departamento'
            });
        }

        const localities = await prisma.locality.findMany({
            where: {
                ...(province && { provinceName: province }),
                ...(department && { departmentName: department })
            },
            select: { name: true },
            distinct: ['name'],
            orderBy: { name: 'asc' }
        });

        return res.status(200).json({
            data: localities.map(locality => locality.name)
        });
    } catch (error) {
        console.error('Error al obtener localidades:', error);
        return res.status(500).json({ error: 'Error al cargar localidades' });
    }
};

export const getProvinces = async (req, res) => {
    try {
        const provinces = await prisma.locality.findMany({
            where: { provinceName: { not: null } },
            select: { provinceName: true },
            distinct: ['provinceName'],
            orderBy: { provinceName: 'asc' }
        });

        return res.status(200).json({
            data: provinces
                .map(locality => locality.provinceName)
                .filter(province => province !== null)
        });
    } catch (error) {
        console.error('Error al obtener provincias:', error);
        return res.status(500).json({ error: 'Error al cargar provincias' });
    }
};

export const getDepartments = async (req, res) => {
    const province = typeof req.query.province === 'string' ? req.query.province.trim() : '';

    if (!province) {
        return res.status(400).json({ error: 'Debe indicar una provincia' });
    }

    try {
        const departments = await prisma.locality.findMany({
            where: {
                provinceName: province,
                departmentName: { not: null }
            },
            select: { departmentName: true },
            distinct: ['departmentName'],
            orderBy: { departmentName: 'asc' }
        });

        return res.status(200).json({
            data: departments
                .map(locality => locality.departmentName)
                .filter(department => department !== null)
        });
    } catch (error) {
        console.error('Error al obtener departamentos:', error);
        return res.status(500).json({ error: 'Error al cargar departamentos' });
    }
};
