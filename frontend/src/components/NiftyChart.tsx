import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { api } from '@/lib/api';

interface NiftyChartProps {
    width?: number;
    height?: number;
}

export default function NiftyChart({ width = 800, height = 500 }: NiftyChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<any>(null);
    const smaSeriesRef = useRef<any>(null);

    const [loading, setLoading] = useState(true);
    const [lastFetch, setLastFetch] = useState<number>(0);

    const fetchChartData = async () => {
        try {
            const data = await api.getNiftyChart();

            // Format data for lightweight-charts
            const candles = data.candles.map((c: any) => ({
                time: c.time as Time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            })).sort((a: any, b: any) => (a.time as number) - (b.time as number));

            const sma = data.sma9.map((s: any) => ({
                time: s.time as Time,
                value: s.value
            })).sort((a: any, b: any) => (a.time as number) - (b.time as number));

            // Set data on series
            if (candleSeriesRef.current && candles.length > 0) {
                candleSeriesRef.current.setData(candles);

                // Add markers for signals
                if (data.signals && data.signals.length > 0) {
                    const markers = data.signals.map((sig: any) => ({
                        time: sig.time as Time,
                        position: sig.direction === 'UP' ? 'belowBar' : 'aboveBar',
                        color: sig.direction === 'UP' ? '#00E676' : '#FF3D57',
                        shape: sig.direction === 'UP' ? 'arrowUp' : 'arrowDown',
                        text: sig.message
                    })).sort((a: any, b: any) => (a.time as number) - (b.time as number));

                    candleSeriesRef.current.setMarkers(markers);
                }
            }

            if (smaSeriesRef.current && sma.length > 0) {
                smaSeriesRef.current.setData(sma);
            }

            setLastFetch(Date.now());
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch Nifty chart data:", err);
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Initialize chart
        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height,
            layout: {
                background: { color: 'transparent' },
                textColor: 'rgba(255, 255, 255, 0.7)',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });
        chartRef.current = chart;

        // Add Candle series
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#00E676',
            downColor: '#FF3D57',
            borderVisible: false,
            wickUpColor: '#00E676',
            wickDownColor: '#FF3D57',
        });
        candleSeriesRef.current = candleSeries;

        // Add SMA Line series
        const smaSeries = chart.addSeries(LineSeries, {
            color: '#3B7BFF',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
        });
        smaSeriesRef.current = smaSeries;

        // Fetch initial data
        fetchChartData();

        // Setup resize observer
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        // Fetch updates periodically (every 1 seconds)
        const interval = setInterval(() => {
            fetchChartData();
        }, 1000);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearInterval(interval);
            chart.remove();
        };
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {loading && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.5)', zIndex: 10, borderRadius: 14
                }}>
                    <div style={{ color: 'var(--text-muted)' }}>Loading Chart Data...</div>
                </div>
            )}
            <div ref={chartContainerRef} style={{ width: '100%', height }} />
            <div style={{ position: 'absolute', top: 10, left: 10, pointerEvents: 'none' }}>
                <span style={{
                    background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 4,
                    fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)'
                }}>
                    NIFTY 50 (3m) & SMA-9
                </span>
            </div>
            {!loading && (
                <div style={{ position: 'absolute', bottom: -25, right: 0, fontSize: 10, color: 'var(--text-muted)' }}>
                    Last updated: {new Date(lastFetch).toLocaleTimeString()}
                </div>
            )}
        </div>
    );
}
