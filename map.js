import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoidHZyYm8iLCJhIjoiY21ha2NzbHhwMTdtdDJqb2pwbTk1YTd4diJ9.FWa-uLEESVRsn2PeMPSntw';

// Format time from minutes to HH:MM AM/PM
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper to get minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips based on time
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Compute station traffic from trips data
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  // Update each station
  return stations.map((station) => {
    let id = station.short_name;
    station.departures = departures.get(id) || 0;
    station.arrivals = arrivals.get(id) || 0;
    station.totalTraffic = station.departures + station.arrivals;
    station.stationName = station.name || 'Unknown Station';
    return station;
  });
}

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/tvrbo/cmakd9xrt010201sn7miu5cbs',
  center: [-71.09415, 42.36027], 
  zoom: 12,
  minZoom: 5, 
  maxZoom: 18, 
});

// Create a tooltip div that will follow the mouse
const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'station-tooltip')
  .style('position', 'absolute')
  .style('visibility', 'hidden')
  .style('background-color', 'white')
  .style('color', 'black')
  .style('padding', '10px')
  .style('border-radius', '5px')
  .style('box-shadow', '0 0 10px rgba(0,0,0,0.3)')
  .style('z-index', 10000)
  .style('pointer-events', 'none');

// Create quantize scale for traffic flow
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', async () => {
  // adding routes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-1',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-2',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'orange',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });
  
  // Add legend to the page
  const legendDiv = document.createElement('div');
  legendDiv.className = 'legend';
  
  // Create legend items
  const legendItems = [
    { ratio: 1, label: 'More departures' },
    { ratio: 0.5, label: 'Balanced' },
    { ratio: 0, label: 'More arrivals' }
  ];
  
  legendItems.forEach(item => {
    const div = document.createElement('div');
    div.style.setProperty('--departure-ratio', item.ratio);
    div.textContent = item.label;
    legendDiv.appendChild(div);
  });
  
  // Add legend after the map
  document.querySelector('#map').insertAdjacentElement('afterend', legendDiv);
  
  // d3 visualization
  try {
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

    const jsonData = await d3.json(jsonurl);

    console.log('Loaded JSON Data:', jsonData);

    // Load trips with parsing of date objects
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );
    
    console.log('Sample CSV rows:', trips.slice(0, 3));

    // Compute initial station traffic
    const stations = computeStationTraffic(jsonData.data.stations, trips);
    
    console.log('Stations Array:', stations);

    // Create radius scale for circle sizes
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);
    
    console.log('Traffic range:', d3.extent(stations, d => d.totalTraffic));
    console.log('Sample station traffic values:', stations.slice(0, 5).map(s => s.totalTraffic));

    const svg = d3.select('#map').select('svg');

    // Create circles with custom tooltip behavior
    const circles = svg
      .selectAll('circle')
      .data(stations, d => d.short_name) // Use station short_name as key
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('--departure-ratio', d => 
        stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5)
      )
      .style('cursor', 'pointer')
      .style('pointer-events', 'all')
      // Mouseover event to show tooltip
      .on('mouseover', function(event, d) {
        tooltip
          .html(`<strong>${d.stationName}</strong><br>
                 ${d.totalTraffic} trips<br>
                 ${d.departures} departures<br>
                 ${d.arrivals} arrivals<br>
                 ${Math.round(d.departures/d.totalTraffic * 100)}% departures`)
          .style('visibility', 'visible');
      })
      // Mousemove event to position tooltip
      .on('mousemove', function(event) {
        tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      // Mouseout event to hide tooltip
      .on('mouseout', function() {
        tooltip.style('visibility', 'hidden');
      });

    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy)
        .attr('r', d => radiusScale(d.totalTraffic));
    }
    
    updatePositions();
  
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    
    // Time slider elements
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    
    // Function to update scatterplot based on time filter
    function updateScatterPlot(timeFilter) {
      // Get only the trips that match the selected time filter
      const filteredTrips = filterTripsbyTime(trips, timeFilter);

      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stations, filteredTrips);

      // Adjust radius scale range based on filtering
      timeFilter === -1 
        ? radiusScale.range([0, 25]) 
        : radiusScale.range([3, 50]);

      // Update the scatterplot by adjusting the radius of circles
      circles
        .data(filteredStations, d => d.short_name) // Use station short_name as key
        .join('circle') // Ensure the data is bound correctly
        .attr('r', d => radiusScale(d.totalTraffic)) // Update circle sizes
        .style('--departure-ratio', d => 
          stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5)
        );
    }
    
    // Function to update time display and filter data
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }

      // Call updateScatterPlot to reflect the changes on the map
      updateScatterPlot(timeFilter);
    }
    
    // Bind slider event to update function
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    // Initialize display
    updateTimeDisplay();
    
  } catch (error) {
    console.error('Error loading JSON:', error);
  }
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}