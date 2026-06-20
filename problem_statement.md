Problem Description
Background

CCTV cameras have become crucial assets in investigating crimes, accidents, and missing person cases. However, investigators often face the tedious and time-consuming task of manually reviewing hours of footage from multiple cameras to locate specific persons, vehicles, or objects of interest.

There is an urgent need for an AI-powered video analysis tool that can automatically detect and extract relevant frames based on searchable keywords (e.g., 'red car', 'person in black jacket') or reference images (e.g., suspect’s photo). Such a tool would significantly reduce investigation time and improve operational efficiency.


There is currently no unified, user-friendly tool available to investigators that can process large volumes of CCTV footage and automatically extract relevant frames or segments based on visual similarity or contextual keywords, especially in field investigations with limited technical resources.


Assist investigators in quickly locating critical moments from long CCTV videos
Improve accuracy and reduce manual effort
Enable rapid response in missing person, theft, or terrorism cases
Provide forensically sound and exportable output for case documentation


Design and build an AI-based CCTV Analysis Tool (desktop or web-based) with the following core capabilities:

Core Functionalities:

1.  Input Handling:

o Ingest raw CCTV footage (common formats like .mp4, .avi, .mov)

o Allow batch upload from multiple cameras or timeframes

2.  Search by Reference Image:

o Upload a photo of a person, vehicle, or object

o Perform face/object re-identification across frames

o Return timestamped frames or short video clips where matches are detected

3.  Search by Keyword:

o Allow search using natural-language or tag-based keywords (e.g., "white van", "man with helmet", "police uniform")

o Use object detection, pose estimation, and colour/attribute recognition

4.  Result Display:

o Show extracted frames along with timestamps and camera ID

o Provide options to export matching clips, reports, or annotated images

5. Frame Filtering:

o Fetch relevant frames only from long footages by keyword input or image input



Multi-language support for keywords (e.g., Hindi, Gujarati)
Filtering by time window, motion events, or activity zones
Integration with facial recognition or license plate recognition APIs
Report generation with chain-of-custody metadata
Live-feed snapshot scanning (for future deployments)


Accuracy and speed of frame extraction
Robustness across different CCTV angles, lighting, and resolutions
User interface simplicity for non-technical officers
Innovation in combining vision and NLP technologies
Scalability and offline usability


Real-time demo with sample CCTV footage
Visualization dashboard (timeline view, search history, tag cloud)
Use of lightweight models for field deployment
Compliance with forensic standards (e.g., integrity hash for exports)
