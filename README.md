# MeetMe Autorespond

MeetMe Autorespond is a project designed to automate responses on the MeetMe platform. It uses AI to analyze chat history and determine the appropriate phase of interaction, then sends automated replies based on the current phase.

## Features

- Automated chat response based on interaction phase.
- Integration with RabbitMQ for message queueing.
- Uses Puppeteer for web automation.
- Google Sheets integration for chat history management.

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/teretzdev/meetme-autorespond.git
   cd meetme-autorespond
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the `meetme_data` directory with the following variables:
   ```
   MEETME_USERNAME=your_username
   MEETME_PASSWORD=your_password
   ```

4. **Run the application**:
   ```bash
   npm start
   ```

## Usage

- The application will automatically log in to MeetMe and start processing messages.
- Messages are analyzed and responded to based on the interaction phase.
- Check the logs for detailed information about the processing.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

This project is licensed under the MIT License.

