export function createBuildingJson(canvas, buildingPolygons, imageFilename) {
    const colorPalette = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
        '#E63946', '#F77F00', '#06D6A0', '#118AB2', '#073B4C',
        '#FFB703', '#FB8500', '#8338EC', '#3A86FF', '#FF006E'
    ];

    const buildings = buildingPolygons.map((poly) => ({
        id: `building_${poly.index}`,
        name: `Gebäude ${poly.index}`,
        gruppe: 'Unbekannt',
        beschreibung: '',
        highlightColor: colorPalette[poly.index % colorPalette.length],
        polygon: poly.polygon
    }));

    return {
        image: {
            filename: imageFilename,
            width: canvas.width,
            height: canvas.height
        },
        buildings
    };
}
