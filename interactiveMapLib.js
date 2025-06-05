/**
 * InteractiveMapLibrary
 * A library to create an interactive map with data from a Google Sheet.
 *
 * Requires:
 * - SheetJS (xlsx.full.min.js): For parsing Excel data from Google Sheets.
 * (https://github.com/SheetJS/sheetjs)
 * - Chart.js: For displaying charts.
 * (https://www.chartjs.org/)
 *
 * Google Sheet Structure:
 * Expected columns: 'id', 'color', 'data1', 'data2'
 * - id: Matches the 'id' attribute of shapes (paths, polylines, rects, etc.) in your SVG map.
 * - color: The fill color for the map region (e.g., '#FF0000', 'blue').
 * - data1: A numerical value to be charted.
 * - data2: Another numerical value to be charted.
 * (Optional: 'displayName' for tooltips/titles if different from 'id')
 * (Optional: 'description' for the clicked region)
 */
class InteractiveMapLibrary {
    /**
     * @param {object} config Configuration object.
     * @param {string} config.mapElementId ID of the <object> tag embedding the SVG map, or the ID of the <svg> element itself.
     * @param {string} config.tooltipElementId ID of the HTML element to use as a tooltip.
     * @param {string} config.chartCanvasId ID of the <canvas> element for the chart.
     * @param {string} config.descriptionElementId ID of the HTML element for displaying descriptions.
     * @param {string} config.legendElementId ID of the HTML element for displaying chart legend.
     * @param {string} config.googleSheetUrl The public URL to your Google Sheet (exported as .xlsx).
     * @param {string} [config.sheetName=null] Specific sheet name to use. If null, uses the first sheet.
     * @param {string} [config.data1Label='Data 1'] Label for data1 in the chart.
     * @param {string} [config.data2Label='Data 2'] Label for data2 in the chart.
     */
    constructor(config) {
        this.config = {
            sheetName: null, // Default to the first sheet
            data1Label: 'Data 1',
            data2Label: 'Data 2',
            ...config,
        };

        this.mapElement = document.getElementById(this.config.mapElementId);
        this.tooltipElement = document.getElementById(this.config.tooltipElementId);
        this.chartCanvas = document.getElementById(this.config.chartCanvasId);
        this.descriptionElement = document.getElementById(this.config.descriptionElementId);
        this.legendElement = document.getElementById(this.config.legendElementId);


        if (!this.mapElement || !this.tooltipElement || !this.chartCanvas || !this.descriptionElement || !this.legendElement) {
            console.error('InteractiveMapLibrary: One or more required HTML elements not found. Please check your config IDs.');
            return;
        }
        if (typeof XLSX === 'undefined') {
            console.error('InteractiveMapLibrary: XLSX library (SheetJS) is not loaded.');
            return;
        }
        if (typeof Chart === 'undefined') {
            console.error('InteractiveMapLibrary: Chart.js library is not loaded.');
            return;
        }

        this.mapData = {}; // To store processed data: { id: { color, data1, data2, displayName, description } }
        this.chartInstance = null;

        this._init();
    }    async _init() {
        try {
            // Load SVG first to avoid CORS issues
            await this._loadSVGDirectly();
            
            const workbook = await this._fetchAndParseSheet();
            if (workbook) {
                this._processData(workbook);
                this._setupMapInteractions();
            }
        } catch (error) {
            console.error('InteractiveMapLibrary: Initialization failed.', error);
            if (this.descriptionElement) {
                this.descriptionElement.innerHTML = `<p style="color: red;">Error initializing map: ${error.message}</p>`;
            }
        }
    }

    async _loadSVGDirectly() {
        try {
            // Check if the map element is a div (our new structure) or an existing SVG
            if (this.mapElement.tagName.toLowerCase() === 'div') {
                const response = await fetch('Map-Aranayaka.svg');
                const svgText = await response.text();
                
                // Create SVG element from text
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
                const svgElement = svgDoc.documentElement;
                
                // Set up the SVG element
                svgElement.style.width = '100%';
                svgElement.style.height = '100%';
                svgElement.id = this.mapElement.id + '_svg';
                
                // Replace the div content with the SVG
                this.mapElement.innerHTML = '';
                this.mapElement.appendChild(svgElement);
                
                // Update the reference to point to the SVG
                this.svgElement = svgElement;
                
                console.log('InteractiveMapLibrary: SVG loaded directly into div container');
            } else if (this.mapElement.tagName.toLowerCase() === 'svg') {
                this.svgElement = this.mapElement;
            }
        } catch (error) {
            console.error('InteractiveMapLibrary: Failed to load SVG directly:', error);
            throw error;
        }
    }

    async _fetchAndParseSheet() {
        try {
            const response = await fetch(this.config.googleSheetUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch sheet: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return XLSX.read(arrayBuffer, { type: 'array' });
        } catch (error) {
            console.error('InteractiveMapLibrary: Error fetching or parsing sheet.', error);
            if (this.descriptionElement) {
                this.descriptionElement.innerHTML = `<p style="color: red;">Error loading map data. Please check the sheet URL and format.</p>`;
            }
            return null;
        }
    }

    _processData(workbook) {
        const sheetName = this.config.sheetName || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            console.error(`InteractiveMapLibrary: Sheet "${sheetName}" not found in the workbook.`);
            if (this.descriptionElement) {
                this.descriptionElement.innerHTML = `<p style="color: red;">Error: Sheet "${sheetName}" not found.</p>`;
            }
            return;
        }

        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        jsonData.forEach(row => {
            // Ensure 'id' from sheet is treated as a string for reliable matching with SVG element IDs
            const id = row.id ? String(row.id).trim() : null;
            const color = row.color ? String(row.color).trim() : 'lightgray';
            const data1 = parseFloat(row.data1);
            const data2 = parseFloat(row.data2);
            const displayName = row.displayName ? String(row.displayName).trim() : id;
            const description = row.description ? String(row.description).trim() : `Details for ${displayName || id}`;

            if (id && !isNaN(data1) && !isNaN(data2)) {
                this.mapData[id] = {
                    color,
                    data1,
                    data2,
                    displayName: displayName || id,
                    description: description || `Details for ${displayName || id}`
                };
            } else {
                console.warn('InteractiveMapLibrary: Skipping row due to missing id or invalid data:', row);
            }
        });

        if (Object.keys(this.mapData).length === 0) {
            console.warn("InteractiveMapLibrary: No valid data processed from the sheet.");
            if (this.descriptionElement) this.descriptionElement.textContent = "No data loaded or data format is incorrect.";
        }
    }    _setupMapInteractions() {
        if (this.svgElement) {
            // We already have the SVG loaded directly
            this._applyStylesAndListeners(document);
            console.log('InteractiveMapLibrary: Setting up interactions for directly loaded SVG');
        } else if (this.mapElement.tagName.toLowerCase() === 'object') {
            this.mapElement.addEventListener('load', () => {
                const svgDoc = this.mapElement.contentDocument;
                if (svgDoc) {
                    this._applyStylesAndListeners(svgDoc);
                } else {
                    console.error('InteractiveMapLibrary: Could not access SVG document within <object>. This might be due to CORS restrictions. Consider embedding the SVG directly in HTML.');
                    // Try to fall back to direct SVG embedding
                    this._convertObjectToDirectSVG();
                }
            });
            
            // Add error handling for failed loads
            this.mapElement.addEventListener('error', () => {
                console.error('InteractiveMapLibrary: Failed to load SVG via <object> tag. Converting to direct SVG embedding.');
                this._convertObjectToDirectSVG();
            });
        } else if (this.mapElement.tagName.toLowerCase() === 'svg') { // Direct SVG
             this._applyStylesAndListeners(this.mapElement);
        } else {
            console.error('InteractiveMapLibrary: Map element must be an <object> embedding an SVG, an <svg> element itself, or a div container for direct SVG loading.');
        }
    }

    async _convertObjectToDirectSVG() {
        try {
            const svgUrl = this.mapElement.getAttribute('data');
            const response = await fetch(svgUrl);
            const svgText = await response.text();
            
            // Create a new SVG element from the text
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgElement = svgDoc.documentElement;
            
            // Copy attributes from object to SVG
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.id = this.mapElement.id;
            
            // Replace the object with the SVG
            this.mapElement.parentNode.replaceChild(svgElement, this.mapElement);
            this.mapElement = svgElement;
            
            // Apply interactions to the new SVG
            this._applyStylesAndListeners(document);
            
        } catch (error) {
            console.error('InteractiveMapLibrary: Failed to convert object to direct SVG:', error);
        }
    }    _applyStylesAndListeners(svgDocOrElement) {
        // Handle both SVG document and direct SVG element
        let rootSvg;
        if (this.svgElement) {
            // Use our directly loaded SVG element
            rootSvg = this.svgElement;
        } else {
            rootSvg = svgDocOrElement.documentElement || svgDocOrElement;
        }
        
        // Create and inject styles
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            
        style.textContent = `
            polyline[id], path[id], polygon[id], rect[id], circle[id], ellipse[id] {
                stroke: black;
                stroke-width: 0.5;
                stroke-linejoin: round;
                transition: fill 0.2s ease, filter 0.2s ease, stroke-width 0.2s ease;
                cursor: pointer;
            }
            polyline[id]:hover, path[id]:hover, polygon[id]:hover, rect[id]:hover, circle[id]:hover, ellipse[id]:hover {
                filter: brightness(1.2) drop-shadow(0 2px 2px rgba(0,0,0,0.3));
            }
        `;
        
        if (rootSvg.firstChild) {
            rootSvg.insertBefore(style, rootSvg.firstChild);
        } else {
            rootSvg.appendChild(style);
        }

        // Find all interactive elements - look for polylines, paths, and other shapes with IDs
        const interactiveElements = rootSvg.querySelectorAll('polyline[id], path[id], polygon[id], rect[id], circle[id], ellipse[id]');

        console.log(`InteractiveMapLibrary: Found ${interactiveElements.length} interactive elements in SVG`);
        console.log('Available element IDs:', Array.from(interactiveElements).map(el => el.id));
        console.log('Data keys:', Object.keys(this.mapData));

        interactiveElements.forEach(element => {
            const id = element.id;
            const regionData = this.mapData[id];

            console.log(`Processing element with ID: ${id}`, regionData ? 'Has data' : 'No data');

            if (regionData) {
                // Apply fill color
                element.style.fill = regionData.color;
                element.style.fillOpacity = '0.8';
                
                // Add interaction events
                element.addEventListener('mousemove', (event) => {
                    this.tooltipElement.style.display = 'block';
                    const nameToShow = regionData.displayName || id;
                    this.tooltipElement.innerHTML = nameToShow;
                    this.tooltipElement.style.left = `${event.pageX + 15}px`;
                    this.tooltipElement.style.top = `${event.pageY + 10}px`;
                });

                element.addEventListener('mouseout', () => {
                    this.tooltipElement.style.display = 'none';
                });

                element.addEventListener('click', () => {
                    this._displayChartForId(id);
                    if (this.descriptionElement) {
                        this.descriptionElement.innerHTML = `<h3>${regionData.displayName || id}</h3><p>${regionData.description || 'No description available.'}</p>`;
                    }
                    // Reset stroke width for all interactive elements
                    interactiveElements.forEach(el => {
                        el.style.strokeWidth = "0.5";
                        el.style.stroke = "black";
                    });
                    // Highlight the clicked element
                    element.style.strokeWidth = "2";
                    element.style.stroke = regionData.color;
                });
            } else {
                // If ID is present but not in mapData
                element.style.fill = 'lightgray';
                element.style.fillOpacity = '0.8';
                element.addEventListener('mousemove', (event) => {
                    this.tooltipElement.style.display = 'block';
                    this.tooltipElement.innerHTML = `${id} (No data)`;
                    this.tooltipElement.style.left = `${event.pageX + 15}px`;
                    this.tooltipElement.style.top = `${event.pageY + 10}px`;
                });
                element.addEventListener('mouseout', () => {
                    this.tooltipElement.style.display = 'none';
                });
            }
        });

        // Update description element with status
        if (this.descriptionElement) {
             if (interactiveElements.length === 0) {
                this.descriptionElement.innerHTML = `<p style="color: orange;">Map interactions set up, but no SVG elements with 'id' attributes were found. Please check your SVG structure.</p>`;
             } else if (Object.keys(this.mapData).length === 0) {
                this.descriptionElement.innerHTML = `<p style="color: red;">Map loaded, but no data was processed from the sheet, or data format is incorrect.</p>`;
             } else {
                 // Check if any mapData IDs actually matched an SVG element ID
                 const matchedIds = Array.from(interactiveElements).filter(el => this.mapData[el.id]).length;
                 if (matchedIds > 0) {
                    this.descriptionElement.innerHTML = `<p style="color: green;">Map loaded successfully! Found ${matchedIds} regions with data. Click on a region to see details.</p>`;
                 } else if (Object.keys(this.mapData).length > 0) {
                    this.descriptionElement.innerHTML = `
                        <p style="color: red;">Map data loaded, but no IDs in the data matched IDs found in the SVG.</p>
                        <details>
                            <summary>Debug Information</summary>
                            <p><strong>Available SVG IDs:</strong> ${Array.from(interactiveElements).map(el => el.id).join(', ')}</p>
                            <p><strong>Expected IDs from data:</strong> ${Object.keys(this.mapData).join(', ')}</p>
                        </details>`;
                 }
             }
        }
    }

    _displayChartForId(id) {
        const regionData = this.mapData[id];
        if (!regionData) {
            console.warn(`InteractiveMapLibrary: No data found for ID "${id}" to display chart.`);
            if (this.chartInstance) {
                this.chartInstance.destroy();
                this.chartInstance = null;
            }
            if(this.chartCanvas) {
                this.chartCanvas.getContext('2d').clearRect(0, 0, this.chartCanvas.width, this.chartCanvas.height);
            }
            if (this.legendElement) this.legendElement.innerHTML = "";
            return;
        }

        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        const ctx = this.chartCanvas.getContext('2d');
        this.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [this.config.data1Label, this.config.data2Label],
                datasets: [{
                    label: regionData.displayName || id,
                    data: [regionData.data1, regionData.data2],
                    backgroundColor: [
                        this._adjustColor(regionData.color, -30),
                        this._adjustColor(regionData.color, 30)
                    ],
                    borderColor: [ // Use slightly darker/original color for border for better definition
                        this._adjustColor(regionData.color, -10),
                        this._adjustColor(regionData.color, 10)
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Data for ${regionData.displayName || id}`,
                        font: { size: 16 },
                        padding: { top: 10, bottom: 20 }
                    },
                    legend: {
                        display: false // Using custom legend
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Values'
                        }
                    },
                    x: {
                         title: {
                            display: false // Labels are self-explanatory
                        }
                    }
                }
            }
        });
        this._updateLegend(regionData);
    }

    _updateLegend(regionData) {
        if (!this.legendElement) return;
        this.legendElement.innerHTML = ""; // Clear previous legend

        const legendItem1 = document.createElement('div');
        legendItem1.style.display = 'flex';
        legendItem1.style.alignItems = 'center';
        legendItem1.style.marginBottom = '5px';
        const colorBox1 = document.createElement('span');
        colorBox1.style.display = 'inline-block';
        colorBox1.style.width = '15px';
        colorBox1.style.height = '15px';
        colorBox1.style.backgroundColor = this._adjustColor(regionData.color, -30);
        colorBox1.style.marginRight = '8px';
        colorBox1.style.border = `1px solid ${this._adjustColor(regionData.color, -50)}`;
        const label1 = document.createElement('span');
        label1.textContent = `${this.config.data1Label}: ${regionData.data1}`;
        legendItem1.appendChild(colorBox1);
        legendItem1.appendChild(label1);
        this.legendElement.appendChild(legendItem1);

        const legendItem2 = document.createElement('div');
        legendItem2.style.display = 'flex';
        legendItem2.style.alignItems = 'center';
        const colorBox2 = document.createElement('span');
        colorBox2.style.display = 'inline-block';
        colorBox2.style.width = '15px';
        colorBox2.style.height = '15px';
        colorBox2.style.backgroundColor = this._adjustColor(regionData.color, 30);
        colorBox2.style.marginRight = '8px';
        colorBox2.style.border = `1px solid ${this._adjustColor(regionData.color, 10)}`;
        const label2 = document.createElement('span');
        label2.textContent = `${this.config.data2Label}: ${regionData.data2}`;
        legendItem2.appendChild(colorBox2);
        legendItem2.appendChild(label2);
        this.legendElement.appendChild(legendItem2);
    }

    _adjustColor(color, amount) {
        if (typeof color !== 'string' || !color.startsWith('#')) {
             const defaultShade = amount < 0 ? '#555555' : '#AAAAAA';
             return defaultShade;
        }

        let usePound = true;
        color = color.slice(1);
        
        if (color.length !== 3 && color.length !== 6) {
            const defaultShade = amount < 0 ? '#555555' : '#AAAAAA';
            return defaultShade;
        }

        if(color.length === 3){
            color = color[0] + color[0] + color[1] + color[1] + color[2] + color[2];
        }

        const num = parseInt(color, 16);
        if (isNaN(num)) {
            const defaultShade = amount < 0 ? '#555555' : '#AAAAAA';
            return defaultShade;
        }

        let red = (num >> 16) & 0xFF;
        let green = (num >> 8) & 0xFF;
        let blue = num & 0xFF;

        red += amount;
        if (red > 255) red = 255; else if (red < 0) red = 0;

        green += amount;
        if (green > 255) green = 255; else if (green < 0) green = 0;

        blue += amount;
        if (blue > 255) blue = 255; else if (blue < 0) blue = 0;

        return (usePound ? "#" : "") + String("000000" + ((red << 16) | (green << 8) | blue).toString(16)).slice(-6);
    }
}
